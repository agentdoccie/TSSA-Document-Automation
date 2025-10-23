import { Document, Packer, Paragraph, TextRun } from "docx";

export const config = { runtime: "nodejs" };

export default async function handler(req) {
  try {
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email, signatureDate } = await req.json();

    if (!fullName || !witness1Name || !witness2Name || !signatureDate) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const doc = new Document({
      sections: [
        {
          children: [
            // Title
            new Paragraph({
              children: [new TextRun({ text: "COMMON CARRY DECLARATION", bold: true, size: 28 })],
              spacing: { after: 400 },
              alignment: "center",
            }),

            // Body
            new Paragraph({
              children: [
                new TextRun({
                  text: `I, ${fullName}, being of sound mind and under full liability, do hereby proclaim and declare that I am lawfully exercising my right to keep and bear arms for the protection of myself, my family, my community, and my property under Natural and Common Law.`,
                  size: 24,
                }),
              ],
              spacing: { after: 400 },
            }),

            new Paragraph({
              children: [
                new TextRun({
                  text: "This declaration is made freely and voluntarily, without coercion, and stands as a lawful notice to all foreign entities, corporations, or agents that any interference with this right is a trespass upon my inherent liberties.",
                  size: 24,
                }),
              ],
              spacing: { after: 400 },
            }),

            // Signature section
            new Paragraph({
              children: [new TextRun({ text: "Declared this " + signatureDate + ".", size: 24 })],
              spacing: { after: 600 },
            }),

            new Paragraph({
              children: [new TextRun({ text: "Autograph of Declarant: _________________________", size: 24 })],
              spacing: { after: 600 },
            }),

            // Witness 1
            new Paragraph({ children: [new TextRun({ text: "Witness 1 (Printed Name): " + witness1Name, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: "Email: " + (witness1Email || ""), size: 24 })] }),
            new Paragraph({
              children: [new TextRun({ text: "Autograph: _________________________", size: 24 })],
              spacing: { after: 400 },
            }),

            // Witness 2
            new Paragraph({ children: [new TextRun({ text: "Witness 2 (Printed Name): " + witness2Name, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: "Email: " + (witness2Email || ""), size: 24 })] }),
            new Paragraph({
              children: [new TextRun({ text: "Autograph: _________________________", size: 24 })],
              spacing: { after: 400 },
            }),

            // Footer
            new Paragraph({
              children: [
                new TextRun({
                  text: "This document is executed under Common Law jurisdiction — All Rights Reserved.",
                  italics: true,
                  size: 22,
                }),
              ],
              alignment: "center",
            }),
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
