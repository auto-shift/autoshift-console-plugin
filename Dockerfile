# A console plugin ships nothing but static assets — the console fetches plugin-manifest.json and
# the module-federation chunks at runtime and loads them into its own React app. There is no
# server-side code, so the runtime base image is essentially the whole attack surface.
#
# Base images are pinned by digest so a scan result describes exactly what ships. The tag beside
# each digest is documentation only. Bump both together (Dependabot raises the PR), or pass
# --build-arg to rebuild against a newer base without editing the file — which is what the weekly
# rebuild workflow does to pick up Red Hat's patched bases.

# registry.access.redhat.com/ubi9/nodejs-22:latest
ARG BUILDER_IMAGE=registry.access.redhat.com/ubi9/nodejs-22@sha256:9d05b40b1127787dc077edb23b9c71ba505d11c86b803b86537d660fb18732b1
# registry.access.redhat.com/ubi9/nginx-126:latest
ARG RUNTIME_IMAGE=registry.access.redhat.com/ubi9/nginx-126@sha256:78cbc9bccd70e1a13c6ca6fa505c693da1fda90ec6b6754f32135108dd6bfdb0

FROM ${BUILDER_IMAGE} AS build
USER root

# Playwright is a devDependency used only for e2e; downloading browsers would add ~400MB to a
# layer that exists purely to run `yarn build`.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

ADD . /usr/src/app
WORKDIR /usr/src/app

# --immutable fails the build if yarn.lock would change, so CI cannot silently resolve a different
# dependency tree than the one that was reviewed.
RUN LOCAL_YARN="node $(awk '/yarnPath:/{print $2}' .yarnrc.yml)" && \
    $LOCAL_YARN install --immutable && \
    $LOCAL_YARN build

FROM ${RUNTIME_IMAGE}

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
