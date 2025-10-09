# ---------
# Variables
# ---------
CONTRACTS_DIR := packages/contracts
KEEPER_DIR    := packages/keeper
WEB_DIR       := packages/web

SHELL := /usr/bin/bash

# ---------
# Contracts
# ---------
contracts-init:
	@if [ ! -d "$(CONTRACTS_DIR)/src" ]; then \
		cd $(CONTRACTS_DIR) && forge init --no-git; \
	else \
		echo "contracts already initialized"; \
	fi

contracts-build:
	cd $(CONTRACTS_DIR) && forge build

contracts-test:
	cd $(CONTRACTS_DIR) && forge test -vvv

# ---------
# Keeper
# ---------
keeper-init:
	@cd $(KEEPER_DIR) && \
	if [ ! -f package.json ]; then pnpm init; fi && \
	pnpm add viem ethers dotenv p-retry zod && \
	pnpm add -D typescript ts-node @types/node && \
	if [ ! -f tsconfig.json ]; then pnpm exec tsc --init; fi

keeper-build:
	cd $(KEEPER_DIR) && pnpm tsc --noEmit

keeper-dev:
	cd $(KEEPER_DIR) && pnpm dev

# ---------
# Web
# ---------
web-init:
	@cd $(WEB_DIR) && \
	if [ ! -f package.json ]; then \
		pnpm dlx create-next-app@latest . --ts --eslint --app --no-tailwind && \
		pnpm add wagmi viem @rainbow-me/rainbowkit zustand; \
	else \
		echo "web already initialized"; \
	fi

web-dev:
	cd $(WEB_DIR) && pnpm dev

# ---------
# All
# ---------
all: contracts-build keeper-build web-dev

