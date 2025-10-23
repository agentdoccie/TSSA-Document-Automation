document.getElementById('documentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const fullName = document.getElementById('fullName').value.trim();
  const witness1 = document.getElementById('witness1').value.trim();
  const witness2 = document.getElementById('witness2').value.trim();

  const statusMessage = document.getElementById('statusMessage');
  statusMessage.textContent = "Generating your document... please wait.";

  try {
  const response = await fetch('/api/generate-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, witness1, witness2 })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate document.');
    }

    const text = await response.text();

    // Create downloadable file
    const blob = new Blob([text], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fullName.replace(/\s+/g, '_')}_Common_Carry_Declaration.txt`;
    link.click();

    statusMessage.textContent = "✅ Document generated and downloaded successfully!";
  } catch (err) {
    statusMessage.textContent = `❌ Error: ${err.message}`;
  }
});
