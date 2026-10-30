import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { fetchJSON, renderProjects } from '../global.js';

const projects = (await fetchJSON('../lib/projects.json')) ?? [];
const projectsContainer = document.querySelector('.projects');
const projectsTitle = document.querySelector('.projects-title');
const searchInput = document.querySelector('.searchBar');

// Global filter state. Store the selected year (as a string), not a slice
// index, because indices shift whenever the search changes the slices.
let query = '';
let selectedYear = null;

function toggleYear(year) {
  selectedYear = selectedYear === year ? null : year;
  applyFilters();
}

function renderPieChart(projectsGiven) {
  const svg = d3.select('#projects-pie-plot');
  const legend = d3.select('.legend');

  // Clear previous render
  svg.selectAll('path').remove();
  legend.selectAll('li').remove();

  const rolledData = d3.rollups(
    projectsGiven,
    (v) => v.length,
    (d) => d.year,
  );
  const data = rolledData
    .sort((a, b) => d3.ascending(a[0], b[0]))
    .map(([year, count]) => ({ value: count, label: String(year) }));

  const sliceGenerator = d3.pie().value((d) => d.value);
  const arcData = sliceGenerator(data);
  const arcGenerator = d3.arc().innerRadius(0).outerRadius(50);
  const colors = d3.scaleOrdinal(d3.schemeTableau10);

  arcData.forEach((d, idx) => {
    const label = data[idx].label;
    svg
      .append('path')
      .attr('d', arcGenerator(d))
      .attr('fill', colors(idx))
      .classed('selected', label === selectedYear)
      .on('click', () => toggleYear(label));
  });

  data.forEach((d, idx) => {
    legend
      .append('li')
      .attr('class', 'legend-item')
      .attr('style', `--color:${colors(idx)}`)
      .classed('selected', d.label === selectedYear)
      .html(`<span class="swatch"></span> ${d.label} <em>(${d.value})</em>`)
      .on('click', () => toggleYear(d.label));
  });
}

function applyFilters() {
  const searched = projects.filter((project) => {
    const values = Object.values(project).join('\n').toLowerCase();
    return values.includes(query.toLowerCase());
  });

  // Drop a selection that the current search has filtered away
  if (selectedYear !== null && !searched.some((p) => String(p.year) === selectedYear)) {
    selectedYear = null;
  }

  const visible =
    selectedYear === null
      ? searched
      : searched.filter((p) => String(p.year) === selectedYear);

  renderProjects(visible, projectsContainer, 'h2');
  if (projectsTitle) {
    projectsTitle.textContent = `${visible.length} Projects`;
  }

  // The pie reflects the search only, so selecting a year keeps every slice
  renderPieChart(searched);
}

searchInput.addEventListener('input', (event) => {
  query = event.target.value;
  applyFilters();
});

applyFilters();
