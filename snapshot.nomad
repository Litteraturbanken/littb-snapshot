# Snapshot Puppeteer Nomad Job Specification
# -------------------------------------------
#
# - Runs a Node.js web server that renders pages with Puppeteer for SEO/snapshots
# - Uses custom multi-arch image built from this repo
# - Exposes HTTP service and registers in Consul with Caddy ingress tags
#

job "snapshot" {
  datacenters = ["local"]
  type        = "service"

  group "snapshot" {
    count = 1

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
        image        = "ghcr.io/litteraturbanken/littb-snapshot:latest"
        network_mode = "host"
        ports        = ["http"]
      }

      env {
        NODE_ENV    = "production"
        HOST        = "0.0.0.0"
        PORT        = "${NOMAD_PORT_http}"
        SERVER_ROOT = "https://litteraturbanken.se"
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
          "caddy-host=snapshot",
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
