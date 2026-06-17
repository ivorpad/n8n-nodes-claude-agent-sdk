variable "REGISTRY" {
  default = "ghcr.io/example-owner"
}

variable "APP_IMAGE" {
  default = "n8n-claude-sdk"
}

variable "BASE_IMAGE" {
  default = "n8n-claude-sdk-base"
}

variable "RUNNERS_IMAGE" {
  default = "n8n-claude-sdk-runners"
}

variable "CODE_SERVER_IMAGE" {
  default = "n8n-claude-sdk-code-server"
}

variable "PLATFORM" {
  default = "linux/arm64"
}

variable "PLATFORM_KEY" {
  default = "arm64"
}

variable "RELEASE_TAG" {
  default = "dev"
}

variable "BASE_TAG" {
  default = "2026-06-12"
}

variable "RUNNERS_TAG" {
  default = "dev"
}

variable "CODE_SERVER_TAG" {
  default = "dev"
}

variable "CACHE_SCOPE" {
  default = "main"
}

variable "MAIN_CACHE_SCOPE" {
  default = "main"
}

variable "BASE_IMAGE_REF" {
  default = "ghcr.io/example-owner/n8n-claude-sdk-base:2026-06-12"
}

variable "SDK_TARBALL_DIR" {
  default = ".docker/sdk"
}

variable "SDK_TARBALL_NAME" {
  default = "n8n-nodes-claude-agent-sdk.tgz"
}

variable "N8N_VERSION" {
  default = "2.25.7"
}

variable "CLAUDE_CODE_VERSION" {
  default = "2.1.175"
}

variable "PUPPETEER_CORE_VERSION" {
  default = "25.1.0"
}

group "publish-base" {
  targets = ["base"]
}

group "publish-release" {
  targets = ["release"]
}

group "publish-support" {
  targets = ["runners", "code-server"]
}

group "publish-all" {
  targets = ["base", "release", "runners", "code-server"]
}

target "base" {
  context    = "deploy"
  dockerfile = "Dockerfile.base"
  platforms  = ["${PLATFORM}"]
  args = {
    N8N_VERSION            = "${N8N_VERSION}"
    CLAUDE_CODE_VERSION    = "${CLAUDE_CODE_VERSION}"
    PUPPETEER_CORE_VERSION = "${PUPPETEER_CORE_VERSION}"
  }
  tags = [
    "${REGISTRY}/${BASE_IMAGE}:${BASE_TAG}",
  ]
  cache-from = [
    "type=registry,ref=${REGISTRY}/${BASE_IMAGE}:cache-${CACHE_SCOPE}-${PLATFORM_KEY}",
    "type=registry,ref=${REGISTRY}/${BASE_IMAGE}:cache-${MAIN_CACHE_SCOPE}-${PLATFORM_KEY}",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/${BASE_IMAGE}:cache-${CACHE_SCOPE}-${PLATFORM_KEY},mode=max,compression=zstd,image-manifest=true,oci-mediatypes=true",
  ]
  output = ["type=registry"]
}

target "release" {
  context    = "deploy"
  dockerfile = "Dockerfile"
  platforms  = ["${PLATFORM}"]
  contexts = {
    sdk_tarball = "${SDK_TARBALL_DIR}"
  }
  args = {
    BASE_IMAGE          = "${BASE_IMAGE_REF}"
    SDK_TARBALL_NAME    = "${SDK_TARBALL_NAME}"
    CLAUDE_CODE_VERSION = "${CLAUDE_CODE_VERSION}"
  }
  tags = [
    "${REGISTRY}/${APP_IMAGE}:${RELEASE_TAG}",
  ]
  cache-from = [
    "type=registry,ref=${REGISTRY}/${APP_IMAGE}:cache-${CACHE_SCOPE}-${PLATFORM_KEY}",
    "type=registry,ref=${REGISTRY}/${APP_IMAGE}:cache-${MAIN_CACHE_SCOPE}-${PLATFORM_KEY}",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/${APP_IMAGE}:cache-${CACHE_SCOPE}-${PLATFORM_KEY},mode=max,compression=zstd,image-manifest=true,oci-mediatypes=true",
  ]
  output = ["type=registry"]
}

target "runners" {
  context    = "deploy"
  dockerfile = "Dockerfile.runners"
  platforms  = ["${PLATFORM}"]
  tags = [
    "${REGISTRY}/${RUNNERS_IMAGE}:${RUNNERS_TAG}",
  ]
  cache-from = [
    "type=registry,ref=${REGISTRY}/${RUNNERS_IMAGE}:cache-${CACHE_SCOPE}-${PLATFORM_KEY}",
    "type=registry,ref=${REGISTRY}/${RUNNERS_IMAGE}:cache-${MAIN_CACHE_SCOPE}-${PLATFORM_KEY}",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/${RUNNERS_IMAGE}:cache-${CACHE_SCOPE}-${PLATFORM_KEY},mode=max,compression=zstd,image-manifest=true,oci-mediatypes=true",
  ]
  output = ["type=registry"]
}

target "code-server" {
  context    = "deploy"
  dockerfile = "Dockerfile.code-server"
  platforms  = ["${PLATFORM}"]
  tags = [
    "${REGISTRY}/${CODE_SERVER_IMAGE}:${CODE_SERVER_TAG}",
  ]
  cache-from = [
    "type=registry,ref=${REGISTRY}/${CODE_SERVER_IMAGE}:cache-${CACHE_SCOPE}-${PLATFORM_KEY}",
    "type=registry,ref=${REGISTRY}/${CODE_SERVER_IMAGE}:cache-${MAIN_CACHE_SCOPE}-${PLATFORM_KEY}",
  ]
  cache-to = [
    "type=registry,ref=${REGISTRY}/${CODE_SERVER_IMAGE}:cache-${CACHE_SCOPE}-${PLATFORM_KEY},mode=max,compression=zstd,image-manifest=true,oci-mediatypes=true",
  ]
  output = ["type=registry"]
}
