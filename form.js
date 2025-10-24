document.getElementById("generateBtn").addEventListener("click", async () => {
  const fullName = document.getElementById("fullName").value.trim();
  const witness1Name = document.getElementById("witness1Name").value.trim();
  const witness1Email = document.getElementById("witness1Email").value.trim();
  const witness2Name = document.getElementById("witness2Name").value.trim();
  const witness2Email = document.getElementById("witness2Email").value.trim();

  const message = document.getElementById("message");
  message.style.color = "black";
  message.textContent = "⏳ Generating your document, please wait...";

  try {
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

    if (!response.ok || !data.pdfUrl) {
      throw new Error(data.error || "PDF generation failed");
    }

    // ✅ Success — auto-download PDF
    const link = document.createElement("a");
    link.href = data.pdfUrl;
    link.download = `${fullName.replace(/\s+/g, "_")}_CommonCarryDeclaration.pdf`;
    link.click();

    message.style.color = "green";
    message.textContent = "✅ PDF generated successfully! Download should begin automatically.";
  } catch (error) {
    console.error(error);
    message.style.color = "red";
    message.textContent = "❌ Error: Failed to generate PDF.";
  }
});
