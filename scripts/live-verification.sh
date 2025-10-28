#!/bin/bash
echo "🔍 Running Live System Verification..."

if ! nc -z localhost 3000; then
  echo "🟢 Starting backend..."
  vercel dev --listen 3000 >/dev/null 2>&1 &
  sleep 10
else
  echo "✅ Backend already running on port 3000"
fi

echo "🧩 Checking /api/health..."
curl -s http://localhost:3000/api/health

echo "📊 Checking /api/metrics..."
curl -s http://localhost:3000/api/metrics

if [ -f "public/dashboard.html" ]; then
  echo "✅ Dashboard file found: public/dashboard.html"
else
  echo "❌ Dashboard file missing. Rebuilding..."
  mkdir -p public
  echo "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><title>TSSA Dashboard</title><script src=\"https://cdn.tailwindcss.com\"></script></head><body class=\"bg-gray-50 p-6 font-sans\"><h1 class=\"text-3xl font-bold mb-4\">📊 TSSA Live Dashboard</h1><div id=\"output\">Loading...</div><script>async function load(){const health=await fetch(\"/api/health\").then(r=>r.json()).catch(()=>({error:\"Health check failed\"}));const metrics=await fetch(\"/api/metrics\").then(r=>r.json()).catch(()=>({error:\"Metrics check failed\"}));document.getElementById(\"output\").innerText=JSON.stringify({health,metrics},null,2);}load();setInterval(load,10000);</script></body></html>" > public/dashboard.html
fi

echo "✅ Verification complete. Open http://localhost:3000/dashboard.html to view live metrics."

