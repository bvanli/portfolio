import { fetchJSON, renderProjects } from '../global.js';

const projects = await fetchJSON('../lib/projects.json');
const projectsContainer = document.querySelector('.projects');
renderProjects(projects, projectsContainer, 'h2');

// Show the project count in the page title
const projectsTitle = document.querySelector('.projects-title');
if (projectsTitle) {
  const count = projects?.length ?? 0;
  projectsTitle.textContent = `${count} Projects`;
}
