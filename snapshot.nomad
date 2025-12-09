# Snapshot Puppeteer Nomad Job Specification
# -------------------------------------------
#
# - Runs a Node.js web server that renders pages with Puppeteer for SEO/snapshots
# - Uses node:20-slim with Chromium installed at runtime
# - Fetches app code via git artifact
# - Exposes HTTP service and registers in Consul with Caddy ingress tags
#

job "snapshot" {
  datacenters = ["local"]
  type        = "service"

  group "snapshot" {
    count = 1

    # Chromium install takes ~50s, so need longer deadline
    update {
      progress_deadline = "10m"
      healthy_deadline  = "5m"
    }

    network {
      mode = "host"

      port "http" {
        to     = 8282
        static = 8282
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

      # Fetch the app from git
      artifact {
        source      = "git::https://github.com/Litteraturbanken/littb-snapshot.git"
        destination = "local/app"
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
        cpu    = 500   # MHz
        memory = 1024  # MB - Puppeteer needs memory for Chrome
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
