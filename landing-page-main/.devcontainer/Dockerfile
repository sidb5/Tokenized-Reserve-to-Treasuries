FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:0-18

# Install additional dependencies
RUN apt-get update && apt-get install -y \
    libssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Install Prisma CLI
RUN npm install -g prisma

# Set the default shell to bash instead of sh
ENV SHELL /bin/bash
