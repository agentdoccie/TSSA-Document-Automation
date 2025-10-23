// ✅ TSSA Document Automation — Common Carry Declaration Generator
// Clean, stable, and production-ready for Vercel (Node.js runtime)

import { Document, Packer, Paragraph, TextRun } from "docx";

// Ensure this runs in Node.js, not Edge
export const config = { runtime: "nodejs" };

export default async function handler(req) {
  try {
    // Parse incoming JSON data from form
    const {
      fullName = "",
      witness1Name = "",
      witness1Email = "",
      witness2Name = "",
      witness2Email = "",
      signatureDate = new Date().toLocaleDateString(),
    } = await req.json();

    // Validate required fields
    if (!fullName || !witness1Name || !witness2Name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Helper function to sanitize input
    const safe = (t) => (typeof t === "string" ? t.trim() : "");

    // 📝 Create the Word document
    const doc = new Document({
      sections: [
        {
          children: [
            // Title
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

            // Declaration body
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

            // Witness section
            new Paragraph({
              children: [new TextRun({ text: "Witness 1:", bold: true, size: 24 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Name: ${safe(witness1Name)}`, size: 24 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Email: ${safe(witness1Email)}`, size: 24 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: "Autograph: _________________________", size: 24 })],
              spacing: { after: 200 },
            }),

            new Paragraph({
              children: [new TextRun({ text: "Witness 2:", bold: true, size: 24 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Name: ${safe(witness2Name)}`, size: 24 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Email: ${safe(witness2Email)}`, size: 24 })],
            }),
            new Paragraph({
              children: [new TextRun({ text: "Autograph: _________________________", size: 24 })],
              spacing: { after: 400 },
            }),

            // Footer
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

    // 📦 Convert document to a downloadable buffer
    const buffer = await Packer.toBuffer(doc);

    // ✅ Return downloadable file response
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safe(
          fullName
        )}_Common_Carry_Declaration.docx"`,
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
