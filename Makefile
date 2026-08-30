.PHONY: up down build logs ps clean staging check-storage-keys

## Start the full local stack
up:
	docker compose up --build

## Stop and remove containers (keep volumes)
down:
	docker compose down

## Stop and remove containers + volumes (full teardown)
clean:
	docker compose down -v

## Build images without starting
build:
	docker compose build --no-cache

## Tail logs from all services
logs:
	docker compose logs -f

## Show running containers
ps:
	docker compose ps

## Start staging stack
staging:
	docker compose -f docker-compose.yml -f docker-compose.staging.yml up --build

## Check for storage key collisions across contracts
check-storage-keys:
	./scripts/check-storage-keys.sh

