# A console plugin ships nothing but static assets — the console fetches plugin-manifest.json and
# the module-federation chunks at runtime and loads them into its own React app. There is no
# server-side code, so the runtime base image is essentially the whole attack surface.
#
# Base images are pinned by digest so a scan result describes exactly what ships, and written as
# literal FROM lines because Dependabot cannot see an image reference behind an ARG
# (dependabot-core#4597, open since 2022). This file used the ARG form until the pins were found
# eleven days stale: the docker ecosystem ran every week, parsed zero dependencies, and reported
# success, so nothing ever said the pin had stopped moving.
#
# The tag is part of the reference rather than a comment beside it — Dependabot needs it to know
# which stream a digest belongs to, and drops the dependency without it.
#
# Do not collapse these back into an ARG. The weekly rebuild rewrites the digests in its own
# ephemeral checkout, which is how it builds against Red Hat's patched bases without waiting for
# the Dependabot PR to merge.

FROM registry.access.redhat.com/ubi9/nodejs-22:latest@sha256:a38a749f3a37a1c033932b4c13f3052f4958aa0eb7dbb0761cb3b5536ffe6878 AS build
USER root

# Which OpenShift release this image is built for. One image per target: the console supplies
# react, react-router and react-i18next as shared singletons whose versions change between
# releases, so a bundle built for the wrong one loads and then fails silently. Targets and their
# pinned trees live in ocp-targets.json and targets/<minor>/.
ARG OCP_TARGET=4.22

# Playwright is a devDependency used only for e2e; downloading browsers would add ~400MB to a
# layer that exists purely to run `yarn build`.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

ADD . /usr/src/app
WORKDIR /usr/src/app

# Two installs, two lockfiles: the root tree is the build toolchain, targets/<minor> is the
# module-federation contract this image ships against. --immutable fails the build if either
# lockfile would change, so the image cannot be built from a dependency tree nobody reviewed.
RUN set -eu; \
    if [ ! -d "targets/${OCP_TARGET}" ]; then \
      echo "unknown OCP_TARGET '${OCP_TARGET}'; declared: $(ls targets)" >&2; exit 1; \
    fi; \
    YARN_REL="$(awk '/yarnPath:/{print $2}' .yarnrc.yml)"; \
    node "$YARN_REL" install --immutable; \
    (cd "targets/${OCP_TARGET}" && node "../../$YARN_REL" install --immutable); \
    OCP_TARGET="${OCP_TARGET}" node "$YARN_REL" build

FROM registry.access.redhat.com/ubi9/nginx-126:latest@sha256:468ae4288539d349f10803defdc5af72b56335f76fdafa7bccea5c6206fef1de

# Named PLUGIN_* rather than VERSION/REVISION: podman/buildah silently clobbers a build arg
# called VERSION (verified on 5.4.1 — --build-arg VERSION=v9.9.9 lands in the label as "0"), so
# the image would claim a version it was not built at.
ARG PLUGIN_VERSION=0.0.0
ARG PLUGIN_REVISION=unknown

LABEL name="autoshift-console-plugin" \
      vendor="AutoShift" \
      version="${PLUGIN_VERSION}" \
      release="${PLUGIN_REVISION}" \
      summary="AutoShift OpenShift console plugin" \
      description="Read-only console plugin surfacing AutoShift fleet configuration, resolution provenance and drift." \
      io.k8s.display-name="AutoShift Console Plugin" \
      org.opencontainers.image.source="https://github.com/auto-shift/autoshift-console-plugin" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.revision="${PLUGIN_REVISION}" \
      org.opencontainers.image.version="${PLUGIN_VERSION}"

# Only the built assets cross the stage boundary — no source, no node_modules, no build toolchain.
COPY --from=build /usr/src/app/dist /usr/share/nginx/html

# nginx-126 compiles with --conf-path=/etc/nginx/nginx.conf. The AutoShift policy (and the Helm
# chart) mount a config there to add the TLS listener on 9443; the image default serves plain HTTP
# on 8080, which is why the plugin is unusable without that mount.
USER 1001

ENTRYPOINT ["nginx", "-g", "daemon off;"]
