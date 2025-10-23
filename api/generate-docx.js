// ✅ FINAL FIXED VERSION — Works on Vercel with Node.js runtime (no req.json error)

import { Document, Packer, Paragraph, TextRun } from "docx";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // ✅ FIX: manually parse request body
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(buffers).toString());

    const {
      fullName = "",
      witness1Name = "",
      witness1Email = "",
      witness2Name = "",
      witness2Email = "",
      signatureDate = new Date().toLocaleDateString(),
    } = data;

    if (!fullName || !witness1Name || !witness2Name) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const safe = (t) => (typeof t === "string" ? t.trim() : "");

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "COMMON CARRY DECLARATION",
                  bold: true,
                  size: 28,
                }),
              ],
              alignment: "center",
              spacing: { after: 400 },
            }),

            new Paragraph({
              children: [
                new TextRun({
                  text: `I, ${safe(fullName)}, being of sound mind and body, do hereby declare and record my unalienable right to keep and bear arms — to Common Carry — as guaranteed by Natural Law and reaffirmed in Public Law.`,
                  size: 24,
                }),
              ],
              spacing: { after: 300 },
            }),

            new Paragraph({
              children: [
                new TextRun({
                  text: "This Declaration stands as my public record of intent to live peaceably, to defend life, liberty, and property, and to uphold the Public Law of the Land.",
                  size: 24,
                }),
              ],
              spacing: { after: 300 },
            }),

            new Paragraph({
              children: [
                new TextRun({
                  text: `Signed and declared this day of ${safe(signatureDate)}.`,
                  size: 24,
                }),
              ],
              spacing: { after: 400 },
            }),

            new Paragraph({
              children: [new TextRun({ text: "Witness 1:", bold: true, size: 24 })],
            }),
            new Paragraph({ children: [new TextRun({ text: `Name: ${safe(witness1Name)}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Email: ${safe(witness1Email)}`, size: 24 })] }),
            new Paragraph({
              children: [new TextRun({ text: "Autograph: _________________________", size: 24 })],
              spacing: { after: 200 },
            }),

            new Paragraph({
              children: [new TextRun({ text: "Witness 2:", bold: true, size: 24 })],
            }),
            new Paragraph({ children: [new TextRun({ text: `Name: ${safe(witness2Name)}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Email: ${safe(witness2Email)}`, size: 24 })] }),
            new Paragraph({
              children: [new TextRun({ text: "Autograph: _________________________", size: 24 })],
              spacing: { after: 400 },
            }),

            new Paragraph({
              children: [
                new TextRun({
                  text: "Generated automatically by the TSSA Document Automation System",
                  italics: true,
                  size: 20,
                }),
              ],
              alignment: "center",
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    // ✅ send as downloadable DOCX
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safe(fullName)}_Common_Carry_Declaration.docx"`
    );
    res.status(200).send(buffer);
  } catch (err) {
    console.error("Error generating document:", err);
    res.status(500).json({ error: err.message });
  }
}
