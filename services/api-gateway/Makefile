.DEFAULT_GOAL := help

ENV_FILE      ?= ../../infra/snowflake/env/dev.env
DEPLOY_SCRIPT := ../../infra/snowflake/scripts/deploy.sh

-include $(ENV_FILE)
export

IMAGE_TAG     ?= latest
SNOWFLAKE_USER ?= $(shell whoami)

# Local run — override to change the upstream addresses
STTM_BUILDER_UPSTREAM ?= host.docker.internal:8000
FRONTEND_UPSTREAM     ?= host.docker.internal:3000

_DB_LOWER     := $(shell echo '$(SNOWFLAKE_DATABASE)' | tr '[:upper:]' '[:lower:]')
_SCHEMA_LOWER := $(shell echo '$(SNOWFLAKE_SCHEMA)' | tr '[:upper:]' '[:lower:]')
_REPO_LOWER   := $(shell echo '$(SNOWFLAKE_IMAGE_REPOSITORY)' | tr '[:upper:]' '[:lower:]')

_BASE        := $(SNOWFLAKE_REGISTRY_HOST)/$(_DB_LOWER)/$(_SCHEMA_LOWER)/$(_REPO_LOWER)
GATEWAY_IMAGE := $(_BASE)/api-gateway:$(IMAGE_TAG)
FRONTEND_IMAGE := $(_BASE)/frontend:$(IMAGE_TAG)

.PHONY: help build-and-push deploy run

help:
	@echo ""
	@echo "Usage: make <target> [ENV_FILE=path/to/env] [IMAGE_TAG=tag]"
	@echo ""
	@echo "  build-and-push   Build and push api-gateway + frontend images to the Snowflake registry"
	@echo "  deploy           Deploy the api-gateway SPCS service (nginx + frontend containers)"
	@echo "  run              Run api-gateway locally on port 9000"
	@echo ""
	@echo "Defaults: ENV_FILE=$(ENV_FILE)  IMAGE_TAG=$(IMAGE_TAG)"
	@echo "          STTM_BUILDER_UPSTREAM=$(STTM_BUILDER_UPSTREAM)"
	@echo "          FRONTEND_UPSTREAM=$(FRONTEND_UPSTREAM)"
	@echo ""

build-and-push:
	@echo "→ Logging in to $(SNOWFLAKE_REGISTRY_HOST)"
	@echo "$(SNOWFLAKE_PASSWORD)" | docker login $(SNOWFLAKE_REGISTRY_HOST) \
		--username $(SNOWFLAKE_USER) \
		--password-stdin
	@echo "→ Building $(GATEWAY_IMAGE)"
	docker buildx build --platform linux/amd64 -t $(GATEWAY_IMAGE) .
	@echo "→ Building $(FRONTEND_IMAGE)"
	docker buildx build --platform linux/amd64 -t $(FRONTEND_IMAGE) ../frontend
	@echo "→ Pushing images"
	docker push $(GATEWAY_IMAGE)
	docker push $(FRONTEND_IMAGE)
	@echo "✓ Done — $(GATEWAY_IMAGE)  $(FRONTEND_IMAGE)"

deploy:
	@ENV_FILE=$(ENV_FILE) IMAGE_TAG=$(IMAGE_TAG) bash $(DEPLOY_SCRIPT) api-gateway

run:
	@echo "→ Building api-gateway:local"
	docker build -t api-gateway:local .
	@echo "→ Starting api-gateway on http://localhost:9000"
	@echo "   /api/sttm-builder/ → $(STTM_BUILDER_UPSTREAM)"
	@echo "   /                  → $(FRONTEND_UPSTREAM)"
	docker run --rm -p 9000:9000 \
		-e STTM_BUILDER_UPSTREAM=$(STTM_BUILDER_UPSTREAM) \
		-e FRONTEND_UPSTREAM=$(FRONTEND_UPSTREAM) \
		api-gateway:local
