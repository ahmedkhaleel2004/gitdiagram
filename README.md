[![Image](./docs/readme_img.png "GitDiagram Front Page")](https://gitdiagram.com/)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![Kofi](https://img.shields.io/badge/Kofi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/ahmedkhaleel2004)

# GitDiagram

Turn any GitHub repository into an interactive diagram for visualization in seconds.

You can also replace `hub` with `diagram` in any Github URL to access its diagram.

## 🚀 Features

- 👀 **Instant Visualization**: Convert any GitHub repository structure into a system design / architecture diagram
- 🎨 **Interactivity**: Click on components to navigate directly to source files and relevant directories
- ⚡ **Fast Generation**: Powered by Claude 3.5 Sonnet for quick and accurate diagrams
- 🔄 **Customization**: Modify and regenerate diagrams with custom instructions
- 🌐 **API Access**: Public API available for integration (WIP)

## ⚙️ Tech Stack

- **Frontend**: Next.js, TypeScript, Tailwind CSS, ShadCN
- **Backend**: FastAPI, Python, Server Actions
- **Database**: PostgreSQL (with Drizzle ORM)
- **AI**: OpenAI o3-mini
- **Deployment**: Vercel (Frontend), EC2 (Backend)
- **CI/CD**: GitHub Actions
- **Analytics**: PostHog, Api-Analytics

## 🤔 About

I created this because I wanted to contribute to open-source projects but quickly realized their codebases are too massive for me to dig through manually, so this helps me get started - but it's definitely got many more use cases!

Given any public (or private!) GitHub repository it generates diagrams in Mermaid.js with OpenAI's o3-mini! (Previously Claude 3.5 Sonnet)

I extract information from the file tree and README for details and interactivity (you can click components to be taken to relevant files and directories)

Most of what you might call the "processing" of this app is done with prompt engineering - see `/backend/app/prompts.py`. This basically extracts and pipelines data and analysis for a larger action workflow, ending in the diagram code.

## 🔒 How to diagram private repositories

You can simply click on "Private Repos" in the header and follow the instructions by providing a GitHub personal access token with the `repo` scope.

You can also self-host this app locally (backend separated as well!) with the steps below.

## 🛠️ Self-hosting / Local Development

1. Clone the repository

```bash
git clone https://github.com/ahmedkhaleel2004/gitdiagram.git
cd gitdiagram
```

2. Install dependencies

```bash
pnpm i
```

3. Set up environment variables (create .env)

```bash
cp .env.example .env
```

Then edit the `.env` file with your Anthropic API key and optional GitHub personal access token.

4. Run backend

```bash
docker-compose up --build -d
```

Logs available at `docker-compose logs -f`
The FastAPI server will be available at `localhost:8000`

5. Start local database

```bash
chmod +x start-database.sh
./start-database.sh
```

When prompted to generate a random password, input yes.
The Postgres database will start in a container at `localhost:5432`

6. Initialize the database schema

```bash
pnpm db:push
```

You can view and interact with the database using `pnpm db:studio`

7. Run Frontend

```bash
pnpm dev
```

You can now access the website at `localhost:3000` and edit the rate limits defined in `backend/app/routers/generate.py` in the generate function decorator.

## How to run it on local direcotry
Make sure you already can go through the Self-hosting correctly.
1. Create env file
```bash
cp .env.example .env
```
Change the `ENABLE_LOCAL_SERVER` to `True`

2. Mount directrory
Change the `docker-compose.yml`, mount your local directory at volumns. For example, if you want to generate the diagram of directory `/Users/xxx/my-project`. Add one line: `- /Users/xxx/my-project:/app/code` like below:
```
services:
  api:
    build: 
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app
      - /Users/xxx/my-project:/app/code
    env_file:
      - .env
    environment:
      - ENVIRONMENT=${ENVIRONMENT:-development} # Default to development if not set
    restart: unless-stopped
```

3. Run the following command to launch service.
run it.
```bash
docker-compose up --build -d
chmod +x start-database.sh
./start-database.sh
pnpm db:push
pnpm dev
```

4. Go `localhost:3000` and just input any valide github url, eg `https://github.com/yufansong/gitdiagram`. It won't real generate the diagram of that github url, but will trigger the logic to generate the diagram of your local directory previously assigned. 

5. If you meet the "syntax error" like this issue: `https://github.com/ahmedkhaleel2004/gitdiagram/issues/64`. It result from the lack of modal ability. The LLM generated mermaid js is not correct. My temprory solution is:
- Go `backend` directory, you will find `mermaid.txt`. 
- Throw it into an online mermaid editor like this `https://www.mermaidchart.com/play`, then you should get an error if you input the content of `mermaid.txt`.
- Put the `mermaid.txt` and the error log into GPT, let it give you a correct mermard code.
- Go back to `https://www.mermaidchart.com/play` and retry, you will get the result.

As least for me, I can get correctly result for several times by above solution.


## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgements

Shoutout to [Romain Courtois](https://github.com/cyclotruc)'s [Gitingest](https://gitingest.com/) for inspiration and styling

## 📈 Rate Limits

I am currently hosting it for free with no rate limits though this is somewhat likely to change in the future.

<!-- If you would like to bypass these, self-hosting instructions are provided. I also plan on adding an input for your own Anthropic API key.

Diagram generation:

- 1 request per minute
- 5 requests per day -->

## 🤔 Future Steps

- Implement font-awesome icons in diagram
- Implement an embedded feature like star-history.com but for diagrams. The diagram could also be updated progressively as commits are made.
