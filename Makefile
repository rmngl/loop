.PHONY: test build loopd ui desktop desktop-build health

export PATH := $(HOME)/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$(PATH)

test:
	cargo test --workspace

build:
	cargo build --workspace --release

loopd:
	cargo run -p loopd

ui:
	cd apps/loop-ui && npm run dev

desktop: build
	cd apps/loop-desktop && npm run dev

desktop-build: build
	cd apps/loop-desktop && npm install && npm run build

health:
	./scripts/health-check.sh

ui-test:
	cd apps/loop-ui && npm test && npm run build

verify: test ui-test

dev-stack:
	./scripts/dev-stack.sh