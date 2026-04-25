.DEFAULT_GOAL := help

.PHONY: help run

help:
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "  run   Start the Next.js development server on http://localhost:3000"
	@echo ""
	@echo "To build and push the frontend Docker image, run:"
	@echo "  make build-and-push  (from services/api-gateway/)"
	@echo ""
	@echo "To deploy the full api-gateway + frontend SPCS service, run:"
	@echo "  make deploy  (from services/api-gateway/)"
	@echo ""

run:
	npm run dev
