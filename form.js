// Updated client-side form.js with template pre-validation (calls /api/validate-template)

document.getElementById("generateBtn").addEventListener("click", async () => {
  const fullName = document.getElementById("fullName").value.trim();
  const witness1Name = document.getElementById("witness1Name").value.trim();
  const witness1Email = document.getElementById("witness1Email").value.trim();
  const witness2Name = document.getElementById("witness2Name").value.trim();
  const witness2Email = document.getElementById("witness2Email").value.trim();

  const message = document.getElementById("message");
  message.style.color = "black";
  message.textContent = "⏳ Validating your input against the template…";

  try {
    const validationData = {
      FULL_NAME: fullName,
      SIGNATURE_DATE: new Date().toISOString().split("T")[0],
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
    };

    const validateResp = await fetch("/api/validate-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateName: "CommonCarryDeclaration.docx",
        data: validationData,
      }),
    });

    const validateJson = await validateResp.json();

    if (!validateResp.ok) {
      message.style.color = "red";
      message.textContent = `❌ Validation error: ${validateJson.error || "Unknown error"}`;
      return;
    }

    if (Array.isArray(validateJson.missing) && validateJson.missing.length > 0) {
      message.style.color = "red";
      message.textContent = `❌ Please fill these required fields before generating: ${validateJson.missing.join(
        ", "
      )}`;
      return;
    }

    message.style.color = "black";
    message.textContent = "⏳ Generating your document, please wait...";

    const response = await fetch("/api/generate-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName,
        witness1Name,
        witness1Email,
        witness2Name,
        witness2Email,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data?.pdfPath) {
      if (data && data.missing) {
        message.style.color = "red";
        message.textContent = `❌ Missing fields: ${data.missing.join(", ")}`;
        return;
      }
      throw new Error(data?.error || "PDF generation failed");
    }

    message.style.color = "green";
    message.textContent = "✅ Document generated. If a download didn't start automatically, contact admin.";
  } catch (error) {
    console.error(error);
    message.style.color = "red";
    message.textContent = `❌ Error: ${error.message || "Failed to generate PDF."}`;
  }
});
