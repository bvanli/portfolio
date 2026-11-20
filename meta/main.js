import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import scrollama from 'https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm';

let data, commits;
let xScale, yScale, rScale;
let brush;

// Timeline state (built after commits are loaded)
let commitProgress = 100;
let timeScale, commitMaxTime, filteredCommits;
let colors;

async function loadData() {
  const data = await d3.csv('loc.csv', (row) => ({
    ...row,
    line: Number(row.line),
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + 'T00:00' + row.timezone),
    datetime: new Date(row.datetime),
  }));

  return data;
}

function processCommits(data) {
  return d3
    .groups(data, (d) => d.commit)
    .map(([commit, lines]) => {
      let first = lines[0];
      let { author, date, time, timezone, datetime } = first;
      let ret = {
        id: commit,
        url: 'https://github.com/bvanli/portfolio/commit/' + commit,
        author,
        date,
        time,
        timezone,
        datetime,
        hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
        totalLines: lines.length,
      };

      Object.defineProperty(ret, 'lines', {
        value: lines,
        enumerable: false,
        writable: false,
        configurable: false,
      });

      return ret;
    })
    .sort((a, b) => a.datetime - b.datetime);
}

function renderCommitInfo(data, commits) {
  // Clear first so re-renders (slider / scrolling) never stack <dl>s
  d3.select('#stats').selectAll('*').remove();
  const dl = d3.select('#stats').append('dl').attr('class', 'stats');

  dl.append('dt').html('Total <abbr title="Lines of code">LOC</abbr>');
  dl.append('dd').text(data.length);

  dl.append('dt').text('Total commits');
  dl.append('dd').text(commits.length);

  const numFiles = d3.group(data, (d) => d.file).size;
  dl.append('dt').text('Files');
  dl.append('dd').text(numFiles);

  const fileLengths = d3.rollups(
    data,
    (v) => d3.max(v, (v) => v.line),
    (d) => d.file,
  );
  const averageFileLength = d3.mean(fileLengths, (d) => d[1]);
  dl.append('dt').text('Average file length');
  dl.append('dd').text(Math.round(averageFileLength));

  const maxLineLength = d3.max(data, (d) => d.length);
  dl.append('dt').text('Longest line');
  dl.append('dd').text(maxLineLength);

  const workByPeriod = d3.rollups(
    data,
    (v) => v.length,
    (d) => d.datetime.toLocaleString('en', { dayPeriod: 'short' }),
  );
  const maxPeriod = d3.greatest(workByPeriod, (d) => d[1])?.[0];
  dl.append('dt').text('Most active time');
  dl.append('dd').text(maxPeriod);
}

function renderTooltipContent(commit) {
  const link = document.getElementById('commit-link');
  const date = document.getElementById('commit-date');
  const time = document.getElementById('commit-time');
  const author = document.getElementById('commit-author');
  const lines = document.getElementById('commit-lines');

  if (Object.keys(commit).length === 0) return;

  link.href = commit.url;
  link.textContent = commit.id;
  date.textContent = commit.datetime?.toLocaleString('en', {
    dateStyle: 'full',
  });
  time.textContent = commit.datetime?.toLocaleString('en', {
    timeStyle: 'short',
  });
  author.textContent = commit.author;
  lines.textContent = commit.totalLines;
}

function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
}

function renderScatterPlot(data, commits) {
  const width = 1000;
  const height = 600;
  const margin = { top: 10, right: 10, bottom: 30, left: 20 };
  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  const svg = d3
    .select('#chart')
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  xScale = d3
    .scaleTime()
    .domain(d3.extent(commits, (d) => d.datetime))
    .range([usableArea.left, usableArea.right])
    .nice();

  yScale = d3
    .scaleLinear()
    .domain([0, 24])
    .range([usableArea.bottom, usableArea.top]);

  // Gridlines first so they sit beneath the dots
  const gridlines = svg
    .append('g')
    .attr('class', 'gridlines')
    .attr('transform', `translate(${usableArea.left}, 0)`);

  gridlines.call(
    d3.axisLeft(yScale).tickFormat('').tickSize(-usableArea.width),
  );

  // rScale domain uses ALL commits (renderScatterPlot is only ever called
  // with the full list), so a dot keeps its size while scrubbing.
  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
  rScale = d3.scaleSqrt().domain([minLines, maxLines]).range([2, 30]);

  const dots = svg.append('g').attr('class', 'dots');
  renderDots(dots, commits);

  // Axes
  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3
    .axisLeft(yScale)
    .tickFormat((d) => String(d % 24).padStart(2, '0') + ':00');

  svg
    .append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0, ${usableArea.bottom})`)
    .call(xAxis);

  svg
    .append('g')
    .attr('class', 'y-axis')
    .attr('transform', `translate(${usableArea.left}, 0)`)
    .call(yAxis);

  createBrushSelector(svg);
}

// Shared by render and update so circle attributes/handlers can't drift apart
function renderDots(dotsGroup, commits) {
  // Largest first so small dots stay on top and remain hoverable
  const sortedCommits = d3.sort(commits, (d) => -d.totalLines);

  dotsGroup
    .selectAll('circle')
    .data(sortedCommits, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .style('--r', (d) => rScale(d.totalLines))
    .attr('fill', 'steelblue')
    .style('fill-opacity', 0.7)
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mousemove', (event) => {
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    });
}

// Reuses the existing SVG; never appends a new one
function updateScatterPlot(data, commits) {
  const svg = d3.select('#chart').select('svg');

  xScale.domain(d3.extent(commits, (d) => d.datetime)).nice();

  const xAxisGroup = svg.select('g.x-axis');
  xAxisGroup.selectAll('*').remove();
  xAxisGroup.call(d3.axisBottom(xScale));

  // The .dots group already sits above the brush overlay, so updating it in
  // place keeps hover and brushing working.
  renderDots(svg.select('g.dots'), commits);
}

function clearBrush() {
  d3.select('#chart').select('svg').call(brush.move, null);
}

function createBrushSelector(svg) {
  brush = d3.brush().on('start brush end', brushed);
  svg.call(brush);

  // Raise dots and everything after the overlay above it so hover still works
  svg.selectAll('.dots, .overlay ~ *').raise();
}

function isCommitSelected(selection, commit) {
  if (!selection) {
    return false;
  }

  const [[x0, y0], [x1, y1]] = selection;
  const x = xScale(commit.datetime);
  const y = yScale(commit.hourFrac);

  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function brushed(event) {
  const selection = event.selection;

  d3.selectAll('circle').classed('selected', (d) =>
    isCommitSelected(selection, d),
  );

  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

function renderSelectionCount(selection) {
  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];

  const countElement = document.querySelector('#selection-count');
  countElement.textContent = `${
    selectedCommits.length || 'No'
  } commits selected`;

  return selectedCommits;
}

function renderLanguageBreakdown(selection) {
  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];
  const container = document.getElementById('language-breakdown');

  if (selectedCommits.length === 0) {
    container.innerHTML = '';
    return;
  }

  const lines = selectedCommits.flatMap((d) => d.lines);

  // Count lines per language
  const breakdown = d3.rollup(
    lines,
    (v) => v.length,
    (d) => d.type,
  );

  container.innerHTML = '';

  for (const [language, count] of breakdown) {
    const proportion = count / lines.length;
    const formatted = d3.format('.1~%')(proportion);

    container.innerHTML += `
      <dt>${language}</dt>
      <dd>${count} lines (${formatted})</dd>
    `;
  }
}

function renderFileLegend() {
  d3.select('#files-legend')
    .selectAll('li')
    .data(colors.domain())
    .join('li')
    .attr('class', 'legend-item')
    .style('--color', (type) => colors(type))
    .html((type) => `<span class="swatch"></span> ${type}`);
}

function updateFileDisplay(filteredCommits) {
  const lines = filteredCommits.flatMap((d) => d.lines);
  const files = d3
    .groups(lines, (d) => d.file)
    .map(([name, lines]) => ({ name, lines }))
    .sort((a, b) => b.lines.length - a.lines.length);

  // ':scope > div' so the .loc divs inside each <dd> aren't matched
  const filesContainer = d3
    .select('#files')
    .selectAll(':scope > div')
    .data(files, (d) => d.name)
    .join((enter) =>
      enter.append('div').call((div) => {
        div.append('dt');
        div.append('dd');
      }),
    )
    .order();

  // Line count lives in <small> inside <dt>; <dd> holds only the dots
  filesContainer
    .select('dt')
    .html((d) => `<code>${d.name}</code><small>${d.lines.length} lines</small>`);

  filesContainer
    .select('dd')
    .selectAll('div')
    .data((d) => d.lines)
    .join('div')
    .attr('class', 'loc')
    .style('--color', (d) => colors(d.type));
}

// The ONE time-update path, shared by the slider and scrollama
function updateForTime(date) {
  commitMaxTime = date;
  commitProgress = timeScale(date);
  document.getElementById('commit-progress').value = commitProgress;
  document.getElementById('commit-progress-time').textContent =
    commitMaxTime.toLocaleString('en', {
      dateStyle: 'long',
      timeStyle: 'short',
    });

  filteredCommits = commits.filter((d) => d.datetime <= commitMaxTime);
  const filteredData = filteredCommits.flatMap((d) => d.lines);

  clearBrush();
  updateScatterPlot(filteredData, filteredCommits);
  updateFileDisplay(filteredCommits);
  renderCommitInfo(filteredData, filteredCommits);
}

function onTimeSliderChange() {
  const slider = document.getElementById('commit-progress');
  commitProgress = Number(slider.value);
  updateForTime(timeScale.invert(commitProgress));
}

function renderScatterStory(commits) {
  d3.select('#scatter-story')
    .selectAll('.step')
    .data(commits, (d) => d.id)
    .join('div')
    .attr('class', 'step')
    .html((d, i) => {
      const when = d.datetime.toLocaleString('en', {
        dateStyle: 'full',
        timeStyle: 'short',
      });
      const label = i === 0 ? 'my first commit' : 'a commit';
      const numFiles = d3.group(d.lines, (l) => l.file).size;
      return `On ${when}, I made <a href="${d.url}" target="_blank">${label}</a>.
        I edited ${d.totalLines} lines across ${numFiles} ${
          numFiles === 1 ? 'file' : 'files'
        }.`;
    });
}

function onStepEnter(response) {
  const commit = response.element.__data__;
  updateForTime(commit.datetime);
}

data = await loadData();
commits = processCommits(data);
filteredCommits = commits;

timeScale = d3
  .scaleTime()
  .domain(d3.extent(commits, (d) => d.datetime))
  .range([0, 100]);
commitMaxTime = timeScale.invert(commitProgress);

// Color domain set ONCE from all lines so each technology keeps its color
colors = d3
  .scaleOrdinal(d3.schemeTableau10)
  .domain([...new Set(data.map((d) => d.type))].sort());

renderScatterPlot(data, commits);
renderFileLegend();
renderScatterStory(commits);

document
  .getElementById('commit-progress')
  .addEventListener('input', onTimeSliderChange);
onTimeSliderChange();

const scroller = scrollama();
scroller
  .setup({
    container: '#scrolly-1',
    step: '#scrolly-1 .step',
  })
  .onStepEnter(onStepEnter);

window.addEventListener('resize', () => scroller.resize());
