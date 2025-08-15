/* charts.js - Chart rendering logic
 * - Doughnut with responsive % + count labels and callout arrows
 * - Stacked bar with per-segment value labels and adaptive font sizes
 * Uses Chart.js + chartjs-plugin-datalabels
 */

(function(global){
  'use strict';

  // Palette used across charts (HCI-friendly, high contrast)
  const palette = {
    extreme: '#ff6d00',
    high: '#e53935',
    medium: '#1e88e5',
    low: '#43a047',
    neutral: '#90a4ae'
  };

  // Custom plugin: draw callout arrows for doughnut labels
  const doughnutCalloutPlugin = {
    id: 'doughnutCalloutPlugin',
    afterDatasetDraw(chart, args, pluginOptions){
      const { ctx, chartArea, data } = chart;
      const meta = args.meta;
      if (!meta || meta.type !== 'doughnut') return;
      const dataset = data.datasets[args.index];
      if (!dataset) return;

      const cw = chart.width;
      const ch = chart.height;
      const radius = (meta.data[0] && meta.data[0].outerRadius) || Math.min(cw, ch)/2;
      const outer = radius + 8; // line start just outside arc

      ctx.save();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = '#666';

      meta.data.forEach((arc, i) => {
        const value = dataset.data[i];
        if (!value) return;
        const angle = (arc.startAngle + arc.endAngle) / 2;
        const x1 = arc.x + Math.cos(angle) * outer;
        const y1 = arc.y + Math.sin(angle) * outer;
        const x2 = arc.x + Math.cos(angle) * (outer + 16);
        const y2 = arc.y + Math.sin(angle) * (outer + 16);
        // draw line
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // draw small arrow head
        const ah = 5;
        const theta = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - ah * Math.cos(theta - Math.PI/6), y2 - ah * Math.sin(theta - Math.PI/6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - ah * Math.cos(theta + Math.PI/6), y2 - ah * Math.sin(theta + Math.PI/6));
        ctx.stroke();
      });
      ctx.restore();
    }
  };

  // Register required plugins once
  if (typeof Chart !== 'undefined') {
    if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);
    Chart.register(doughnutCalloutPlugin);
  }

  // Helper to compute adaptive font size based on magnitude/space
  function adaptiveFont(base, min, max){
    return (context)=>{
      try{
        const chart = context.chart;
        const w = chart.width || 600;
        const magnitude = Math.log10((context.dataset && context.dataset.data || []).reduce((a,b)=>a+(+b||0),0)+10);
        return Math.max(min, Math.min(max, base + magnitude*1.25 + (w>800?2:0)));
      }catch(e){ return base; }
    };
  }

  function doughnutWithCallouts(canvasId, labels, data, colors){
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const existing = Chart.getChart(ctx);
    if (existing) existing.destroy();
    const total = data.reduce((a,b)=>a+(+b||0),0) || 1;
    return new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { position: 'right' },
          datalabels: {
            color: '#111',
            formatter: (value)=> value ? `${Math.round((value*100)/total)}%\n${value}` : '',
            align: 'end',
            anchor: 'end',
            offset: 8,
            clip: false,
            textStrokeColor: 'white',
            textStrokeWidth: 3,
            font: { weight: '600', size: adaptiveFont(10, 10, 16) }
          }
        }
      },
      plugins: [doughnutCalloutPlugin]
    });
  }

  function stackedWithLabels(canvasId, labels, datasets){
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const existing = Chart.getChart(ctx);
    if (existing) existing.destroy();
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        plugins: {
          legend: { position: 'bottom' },
          datalabels: {
            color: '#fff',
            formatter: (v)=> v? String(v): '',
            clamp: true,
            clip: false,
            textStrokeColor: 'rgba(0,0,0,0.35)',
            textStrokeWidth: 3,
            font: { weight: '700', size: adaptiveFont(9, 9, 14) }
          }
        }
      }
    });
  }

  global.DashboardCharts = {
    palette,
    doughnutWithCallouts,
    stackedWithLabels
  };

})(window);
