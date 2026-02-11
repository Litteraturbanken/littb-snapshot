# Snapshot Puppeteer Nomad Job Specification
# -------------------------------------------
#
# - Runs a Node.js web server that renders pages with Puppeteer for SEO/snapshots
# - Uses node:20-slim with Chromium installed at runtime
# - Fetches app code via git artifact
# - Exposes HTTP service and registers in Consul with Caddy ingress tags
#
# Deploy with:
#   GIT_COMMIT=$(git ls-remote https://github.com/Litteraturbanken/littb-snapshot.git HEAD | cut -f1)
#   nomad job run -var="git_commit=$GIT_COMMIT" snapshot.nomad
#

variable "git_commit" {
  type        = string
  description = "Git commit SHA to deploy (forces redeployment when changed)"
  default     = "HEAD"
}

job "snapshot" {
  datacenters = ["local"]
  type        = "service"

  group "snapshot" {
    count = 3  # Scale horizontally for parallel request handling

    # Run on bare-metal to free cloud node disk space (no CSI needed).
    constraint {
      attribute = "${meta.node_type}"
      value     = "bare-metal"
    }

    # Chromium install takes ~50s, so need longer deadline
    update {
      progress_deadline = "10m"
      healthy_deadline  = "5m"
    }

    network {
      mode = "host"

      port "http" {
        to = 8282
        # Use dynamic port to allow multiple instances on same node
        # Caddy will discover via Consul service registry
      }
    }

    task "snapshot" {
      driver = "docker"

      config {
        image        = "node:20-slim"
        network_mode = "host"
        ports        = ["http"]
        work_dir     = "/local/app"
        command      = "/bin/bash"
        args         = [
          "-c",
          "apt-get update && apt-get install -y chromium --no-install-recommends && npm install --omit=dev && npm start"
        ]
      }

      # Fetch the app from GitHub tarball (avoids git permission issues)
      # Set GIT_COMMIT env var before running: nomad job run -var="git_commit=$(git ls-remote ...)"
      # GitHub tarballs extract to {repo}-{short-commit}/ format, so we strip the directory
      artifact {
        source      = "https://github.com/Litteraturbanken/littb-snapshot/archive/${var.git_commit}.tar.gz"
        destination = "local"
        options {
          archive      = "true"
          strip_prefix = "1"  # Remove the top-level littb-snapshot-{hash} directory
        }
      }

      env {
        NODE_ENV                  = "production"
        HOST                      = "0.0.0.0"
        PORT                      = "${NOMAD_PORT_http}"
        SERVER_ROOT               = "https://litteraturbanken.se"
        PUPPETEER_EXECUTABLE_PATH = "/usr/bin/chromium"
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true"
      }

      resources {
        cpu    = 1500  # MHz - Increased for Puppeteer CPU-bound operations
        memory = 2048  # MB - Increased for Chrome headroom and page pooling
      }

      service {
        name     = "snapshot"
        port     = "http"
        tags     = [
          "snapshot",
          "puppeteer",
          "caddy-host=snapshot.pub.lb.se",
          "caddy-ingress=public"
        ]
        provider = "consul"
        address  = "${meta.bind_ip}"

        check {
          type     = "http"
          path     = "/healthz"
          port     = "http"
          interval = "10s"
          timeout  = "3s"
        }
      }
    }
  }
}
