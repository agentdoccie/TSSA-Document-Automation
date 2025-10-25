// Safe validation and rendering code here
function generatePDF(template) {
    // Validate template
    if (!isValidTemplate(template)) {
        throw new Error('Invalid template');
    }
    // Render PDF
    // ... rendering logic ...
}

function isValidTemplate(template) {
    // Perform validation logic
    return true; // or false based on validation
}
