#!/bin/bash
set -e

echo "🧹 Stopping existing Vercel instances (if any)..."
pkill -f "vercel dev" || true
sleep 2

PORT=3000
echo "🚀 Starting backend on port $PORT..."
vercel dev --listen $PORT >/dev/null 2>&1 &
sleep 3

# Health check
echo "🩺 Checking health at http://localhost:$PORT/api/health ..."
for i in {1..10}; do
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null; then
    echo "✅ Backend is healthy!"
    break
  fi
  echo "⏳ Waiting for backend..."
  sleep 2
done

# Run document generation test
echo "🧾 Running document generation test..."
curl -X POST http://localhost:$PORT/api/generate-all \
  -H "Content-Type: application/json" \
  -d '{
    "templates": ["CommonCarryDeclaration.docx"],
    "data": {
      "FULL_NAME": "Nick Jones",
      "SIGNATURE_DATE": "28th October 2025",
      "WITNESS_1_NAME": "John Witness",
      "WITNESS_1_EMAIL": "john@example.com",
      "WITNESS_2_NAME": "Jane Witness",
      "WITNESS_2_EMAIL": "jane@example.com"
    }
  }' \
  --output output.zip || {
    echo "❌ Document generation failed!"
    exit 1
  }

echo "✅ Document generated successfully → output.zip"