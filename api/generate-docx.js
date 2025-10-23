// ✅ SAFE FINAL VERSION — fixes “expected pattern” error
import { Document, Packer, Paragraph, TextRun } from "docx";

export const config = { runtime: "nodejs" };

export default async function handler(req) {
  try {
    const data = await req.json();
    const safe = (t) => (t && typeof t === "string" ? t.trim() : "");

    const fullName = safe(data.fullName);
    const witness1Name = safe(data.witness1Name);
    const witness1Email = safe(data.witness1Email);
    const witness2Name = safe(data.witness2Name);
    const witness2Email = safe(data.witness2Email);
    const signatureDate = new Date().toLocaleDateString();

    if (!fullName || !witness1Name || !witness2Name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              alignment: "center",
              spacing: { after: 400 },
              children: [
                new TextRun({
                  text: "COMMON CARRY DECLARATION",
                  bold: true,
                  size: 32,
                }),
              ],
            }),

            new Paragraph({
              spacing: { after: 300 },
              children: [
                new TextRun({
                  text: `I, ${fullName}, being of sound mind and body, do hereby declare and record my unalienable right to keep and bear arms — to Common Carry — as guaranteed by Natural Law and reaffirmed in Public Law.`,
                  size: 24,
                }),
              ],
            }),

            new Paragraph({
              spacing: { after: 300 },
              children: [
                new TextRun({
                  text: "This Declaration stands as my public record of intent to live peaceably, to defend life, liberty, and property, and to uphold the Public Law of the Land.",
                  size: 24,
                }),
              ],
            }),

            new Paragraph({
              spacing: { after: 400 },
              children: [
                new TextRun({
                  text: `Signed and declared this day of ${signatureDate}.`,
                  size: 24,
                }),
              ],
            }),

            new Paragraph({ children: [new TextRun({ text: "Witness 1:", bold: true, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Name: ${witness1Name}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Email: ${witness1Email}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: "Autograph: _________________________", size: 24 })], spacing: { after: 200 } }),

            new Paragraph({ children: [new TextRun({ text: "Witness 2:", bold: true, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Name: ${witness2Name}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Email: ${witness2Email}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: "Autograph: _________________________", size: 24 })], spacing: { after: 400 } }),

            new Paragraph({
              alignment: "center",
              children: [
                new TextRun({
                  text: "Generated automatically by the TSSA Document Automation System",
                  italics: true,
                  size: 20,
                }),
              ],
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fullName
          .replace(/\s+/g, "_")
          .toLowerCase()}_Common_Carry_Declaration.docx"`,
      },
    });
  } catch (err) {
    console.error("Error generating document:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
