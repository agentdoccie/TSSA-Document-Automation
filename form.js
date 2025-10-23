// ✅ SAFE VERSION — Works on Vercel with Node.js API routes
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.querySelector("#fullName").value;
    const witness1Name = document.querySelector("#witness1Name").value;
    const witness1Email = document.querySelector("#witness1Email").value;
    const witness2Name = document.querySelector("#witness2Name").value;
    const witness2Email = document.querySelector("#witness2Email").value;

    try {
      const res = await fetch("/api/generate-docx", {
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

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate document");
      }

      // Download the file
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fullName || "CommonCarry"}_Declaration.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      document.querySelector("#error").innerHTML =
        "❌ Error: " + err.message;
    }
  });
});
