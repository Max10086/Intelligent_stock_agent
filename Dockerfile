
# Stage 1: Build the React application
FROM node:20-alpine AS build

# Set the working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
# Use 'npm ci' for cleaner, more reliable builds in CI/CD environments
RUN npm ci

# Copy the rest of the application source code
COPY . .

# The API_KEY needs to be available at build time for Vite to replace it.
# We pass it as a build argument and expose it to Vite with the VITE_ prefix.
ARG API_KEY
ENV VITE_API_KEY=$API_KEY

# Build the application using the script from package.json
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:1.25-alpine

# Copy the custom Nginx configuration for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built static files from the build stage to the Nginx public folder
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80 for the web server
EXPOSE 80

# Start Nginx in the foreground when the container launches
CMD ["nginx", "-g", "daemon off;"]
