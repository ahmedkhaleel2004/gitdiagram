#!/bin/bash

echo "🔧 GitDiagram GitHub PAT Setup"
echo "================================"
echo ""
echo "This script will help you configure a GitHub Personal Access Token (PAT)"
echo "to increase GitHub API rate limits from 60/hour to 5000/hour."
echo ""
echo "📋 Steps to create a GitHub PAT:"
echo "1. Go to https://github.com/settings/tokens"
echo "2. Click 'Generate new token' -> 'Generate new token (classic)'"
echo "3. Give it a name like 'GitDiagram API Access'"
echo "4. Select expiration (recommend 90 days or No expiration)"
echo "5. Select scopes: 'public_repo' (for public repos) or 'repo' (for private repos)"
echo "6. Click 'Generate token'"
echo "7. Copy the token (you won't see it again!)"
echo ""

read -p "Do you have a GitHub PAT ready? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    read -p "Enter your GitHub PAT: " -s github_pat
    echo ""
    
    if [ -z "$github_pat" ]; then
        echo "❌ No token provided. Exiting."
        exit 1
    fi
    
    # Backup existing .env
    if [ -f .env ]; then
        cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
        echo "✅ Backed up existing .env file"
    fi
    
    # Update .env file
    if grep -q "GITHUB_PAT=" .env; then
        # Replace existing GITHUB_PAT line
        sed -i "s/GITHUB_PAT=.*/GITHUB_PAT=$github_pat/" .env
        echo "✅ Updated GITHUB_PAT in .env file"
    else
        # Add GITHUB_PAT line
        echo "GITHUB_PAT=$github_pat" >> .env
        echo "✅ Added GITHUB_PAT to .env file"
    fi
    
    echo ""
    echo "🔄 Restarting backend to apply changes..."
    docker-compose restart api
    
    echo ""
    echo "✅ Setup complete! Your GitHub API rate limit is now 5000/hour instead of 60/hour."
    echo ""
    echo "🧪 Testing the configuration..."
    sleep 3
    
    # Test the configuration
    response=$(curl -s -X POST "http://localhost:8000/generate/cost" \
        -H "Content-Type: application/json" \
        -d '{"username": "facebook", "repo": "react"}')
    
    if echo "$response" | grep -q "cost"; then
        echo "✅ Test successful! GitHub PAT is working correctly."
        echo "Response: $response"
    else
        echo "⚠️  Test failed. Response: $response"
        echo "Please check your GitHub PAT and try again."
    fi
    
else
    echo ""
    echo "📖 Please create a GitHub PAT first and then run this script again."
    echo "Visit: https://github.com/settings/tokens"
fi

echo ""
echo "🔗 For more information, see the README.md file." 