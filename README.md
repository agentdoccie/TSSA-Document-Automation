# TSSA-Document-Automation
The South African Assembly Document Automation Portal

## Environment Variables

This application requires the following environment variable to be set:

- `CLOUDCONVERT_API_KEY` - Your CloudConvert API key for serverless DOCX→PDF conversion

### Setting up on Vercel

1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add `CLOUDCONVERT_API_KEY` with your CloudConvert API key
4. Redeploy your application

## Testing

You can test the PDF generation endpoint with curl:

```bash
curl -X POST https://your-deployment.vercel.app/api/generate-pdf \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "John Doe",
    "witness1Name": "Jane Smith",
    "witness1Email": "jane@example.com",
    "witness2Name": "Bob Johnson",
    "witness2Email": "bob@example.com"
  }' \
  --output output.pdf
```

