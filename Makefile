SHELL := /bin/bash
.PHONY: setup run

setup:
	mise trust && eval "$$(mise activate bash)" && \
		cd src/ui && bun install && \
		cd ../.. && cargo fetch

run:
	cargo tauri dev
