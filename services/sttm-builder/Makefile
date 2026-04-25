.DEFAULT_GOAL := help

ENV_FILE      ?= ../../infra/snowflake/env/dev.env
DEPLOY_SCRIPT := ../../infra/snowflake/scripts/deploy.sh

-include $(ENV_FILE)
export

IMAGE_TAG     ?= latest
SNOWFLAKE_USER ?= $(shell whoami)

_DB_LOWER     := $(shell echo '$(SNOWFLAKE_DATABASE)' | tr '[:upper:]' '[:lower:]')
_SCHEMA_LOWER := $(shell echo '$(SNOWFLAKE_SCHEMA)' | tr '[:upper:]' '[:lower:]')
_REPO_LOWER   := $(shell echo '$(SNOWFLAKE_IMAGE_REPOSITORY)' | tr '[:upper:]' '[:lower:]')

IMAGE := $(SNOWFLAKE_REGISTRY_HOST)/$(_DB_LOWER)/$(_SCHEMA_LOWER)/$(_REPO_LOWER)/sttm-builder:$(IMAGE_TAG)

.PHONY: help install build-and-push deploy run

help:
	@echo ""
	@echo "Usage: make <target> [ENV_FILE=path/to/env] [IMAGE_TAG=tag]"
	@echo ""
	@echo "  install          Install dependencies (uv sync)"
	@echo "  build-and-push   Build the Docker image and push to the Snowflake registry"
	@echo "  deploy           Deploy sttm-builder to Snowflake SPCS"
	@echo "  run              Run the service locally on port 8000 (reads .env.local)"
	@echo ""
	@echo "Defaults: ENV_FILE=$(ENV_FILE)  IMAGE_TAG=$(IMAGE_TAG)"
	@echo ""

install:
	uv sync

build-and-push:
	@echo "→ Logging in to $(SNOWFLAKE_REGISTRY_HOST)"
	@echo "$(SNOWFLAKE_PASSWORD)" | docker login $(SNOWFLAKE_REGISTRY_HOST) \
		--username $(SNOWFLAKE_USER) \
		--password-stdin
	@echo "→ Building $(IMAGE)"
	docker buildx build --platform linux/amd64 -t $(IMAGE) .
	@echo "→ Pushing $(IMAGE)"
	docker push $(IMAGE)
	@echo "✓ Done — $(IMAGE)"

deploy:
	@ENV_FILE=$(ENV_FILE) IMAGE_TAG=$(IMAGE_TAG) bash $(DEPLOY_SCRIPT) sttm-builder

run:
	uv run uvicorn app.main:app --reload --port 8000
