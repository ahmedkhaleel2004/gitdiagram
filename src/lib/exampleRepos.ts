export const exampleRepos = {
  FastAPI: "/fastapi/fastapi",
  Streamlit: "/streamlit/streamlit",
  Flask: "/pallets/flask",
  "api-analytics": "/tom-draper/api-analytics",
  Monkeytype: "/monkeytypegame/monkeytype",
};

function normalizePathSegment(value: string) {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

const exampleRepoPaths = new Set(
  Object.values(exampleRepos).map(normalizePathSegment),
);

export function isExampleRepo(username: string, repo: string) {
  const currentPath = `/${normalizePathSegment(username)}/${normalizePathSegment(repo)}`;
  return exampleRepoPaths.has(currentPath);
}
