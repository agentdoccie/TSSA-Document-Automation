#!/bin/bash
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok() { echo -e "${GREEN}✅${NC} $1"; }
warn() { echo -e "${YELLOW}⚠️ ${NC} $1"; }
err() { echo -e "${RED}❌${NC} $1"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo -e "${BLUE}🔍 Verifying TSSA Document Automation scaffold (no servers will be started)...${NC}"

check_file() {
  local rel="$1"
  if [ -f "$ROOT/$rel" ]; then ok "$rel found"; else err "$rel missing"; fi
}

FILES=(
  "api/health.js"
  "api/metrics.js"
  "api/generate-all.js"
  "lib/metrics.js"
  "scripts/start-backend.sh"
  "scripts/live-verification.sh"
  "scripts/send-alert.js"
  "scripts/test-alerts.js"
  "public/form.html"
)

echo ""
echo "1) Files exist:"
ALL_FILES_OK=1
for f in "${FILES[@]}"; do
  if [ -f "$ROOT/$f" ]; then ok "$f"; else err "$f"; ALL_FILES_OK=0; fi
done

echo ""
echo "2) package.json checks:"
if [ -f "$ROOT/package.json" ]; then
  NEED_DEPS=("docxtemplater" "pizzip" "jszip" "nodemailer" "dotenv")
  MISSING=()
  for dep in "${NEED_DEPS[@]}"; do
    if ! grep -q "\"$dep\"" "$ROOT/package.json"; then MISSING+=("$dep"); fi
  done

  if grep -q "\"backend\"[[:space:]]*:[[:space:]]*\"bash scripts/start-backend.sh\"" "$ROOT/package.json"; then
    ok "scripts.backend present"
  else
    err "scripts.backend missing or incorrect (expected: bash scripts/start-backend.sh)"
  fi

  if [ ${#MISSING[@]} -eq 0 ]; then
    ok "Dependencies present: ${NEED_DEPS[*]}"
  else
    err "Missing dependencies: ${MISSING[*]}"
  fi
else
  err "package.json missing"
fi

echo ""
echo "3) Templates:"
if [ -f "$ROOT/templates/CommonCarryDeclaration.docx" ]; then
  ok "templates/CommonCarryDeclaration.docx found"
else
  err "templates/CommonCarryDeclaration.docx missing"
fi

echo ""
echo "4) .env configuration:"
if [ -f "$ROOT/.env" ]; then
  HAS_HOST=$(grep -E '^SMTP_HOST=' "$ROOT/.env" || true)
  HAS_USER=$(grep -E '^SMTP_USER=' "$ROOT/.env" || true)
  HAS_PASS=$(grep -E '^SMTP_PASS=' "$ROOT/.env" || true)
  HAS_TO=$(grep -E '^ALERT_EMAIL_TO=' "$ROOT/.env" || true)

  if [ -n "$HAS_HOST" ] && [ -n "$HAS_USER" ] && [ -n "$HAS_PASS" ] && [ -n "$HAS_TO" ]; then
    ok ".env contains SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO"
  else
    warn ".env found but appears incomplete (need SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO)"
  fi
else
  warn ".env missing (copy .env.example → .env and fill credentials)"
fi

echo ""
echo -e "${BLUE}Summary:${NC}"
if [ $ALL_FILES_OK -eq 1 ]; then ok "All required files present"; else warn "Some required files are missing"; fi

echo ""
echo -e "${BLUE}Done. No servers were started.${NC}"
