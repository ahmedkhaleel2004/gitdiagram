import styleText from "data-text:./style.module.css"
import type { PlasmoCSConfig } from "plasmo"

import * as style from "./style.module.css"

export const config: PlasmoCSConfig = {
    matches: ["https://github.com/*/*"]
  }

export const getStyle = () => {
  const style = document.createElement("style")
  style.textContent = styleText
  return style
}

const injectButton = () => {
    const isRepoPage = document.querySelector('meta[name="route-pattern"]');
    if(!isRepoPage) {
        return;
    }

    const routePattern = isRepoPage.getAttribute("content");
    if(routePattern !== "/:user_id/:repository/tree/*name(/*path)" && routePattern !== "/:user_id/:repository") {
        return;
    }

    const targetContainer = document.getElementById("repository-details-container");
    if(!targetContainer) {
        return;
    }

    const GitDiagramButton = document.createElement("button");
    GitDiagramButton.className = style.gitdiagram_btn;
    GitDiagramButton.innerHTML = `
        <svg class="${style.gitdiagram_btn_icon} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-arrow-out-up-right-icon lucide-square-arrow-out-up-right">
            <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/>
        </svg>
        Open in GitDiagram
    `

    GitDiagramButton.addEventListener("click", () => {
        const [,user_id, repository] = window.location.pathname.split('/');
        window.open(`https://gitdiagram.com/${user_id}/${repository}`, '_blank');
    })
    
    targetContainer.appendChild(GitDiagramButton);
}

export default injectButton
