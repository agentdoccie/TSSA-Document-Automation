import { Document, Packer, Paragraph, TextRun } from "docx";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  try {
    const { fullName, witness1, witness2 } = await req.json();

    if (!fullName || !witness1 || !witness2) {
      return new Response(JSON.stringify({ error: "Missing form fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create document
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "Common Carry Declaration",
                  bold: true,
                  size: 32,
                }),
              ],
              spacing: { after: 300 },
            }),
            new Paragraph(`I, ${fullName}, hereby declare my right to carry arms lawfully.`),
            new Paragraph(" "),
            new Paragraph(`Witness 1: ${witness1}`),
            new Paragraph(`Witness 2: ${witness2}`),
            new Paragraph(" "),
            new Paragraph("Signed and witnessed under full liability and penalty of perjury."),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const arrayBuffer = await blob.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fullName.replace(/\s+/g, "_")}_Common_Carry_Declaration.docx"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
