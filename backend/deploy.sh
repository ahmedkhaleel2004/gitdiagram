#!/bin/bash

# Exit on any error
set -e

# Navigate to project directory
cd ~/gitdiagram

# Pull latest changes
git pull --ff-only origin main

# Build and restart containers with production environment
docker-compose down
ENVIRONMENT=production docker-compose up --build -d

# Remove unused images
docker image prune -f

# Show logs only if --logs flag is passed
if [ "$1" == "--logs" ]; then
    docker-compose logs -f
else
    echo "Deployment complete! Run 'docker-compose logs -f' to view logs"
fi
