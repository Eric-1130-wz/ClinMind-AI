/**
 * ECharts Topology Visualizer for OSCE Radar and Decision DAG.
 */

class DAGViewManager {
  constructor() {
    this.radarChart = null;
    this.dagChart = null;
    this.miniRadarChart = null;
  }

  initMiniRadar(containerId) {
    const dom = document.getElementById(containerId);
    if (!dom || typeof echarts === 'undefined') return;

    if (this.miniRadarChart) {
      this.miniRadarChart.dispose();
    }
    this.miniRadarChart = echarts.init(dom);
    const option = {
      backgroundColor: '#ffffff',
      radar: {
        indicator: [
          { name: '急救处置力', max: 100 },
          { name: '确诊决策度', max: 100 },
          { name: '鉴别思维广', max: 100 },
          { name: '安全规避度', max: 100 },
          { name: '医患沟通感', max: 100 },
          { name: '临床时效性', max: 100 }
        ],
        radius: '68%',
        splitNumber: 4,
        axisName: {
          color: '#334155',
          fontSize: 10,
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif'
        },
        splitLine: { lineStyle: { color: '#e2e8f0', width: 1 } },
        splitArea: {
          show: true,
          areaStyle: {
            color: ['#ffffff', '#f8fafc', '#ffffff', '#f1f5f9']
          }
        },
        axisLine: { lineStyle: { color: '#cbd5e1' } }
      },
      series: [{
        type: 'radar',
        data: [{
          value: [35, 30, 25, 85, 35, 70],
          name: 'OSCE 实时思维雷达',
          symbolSize: 4,
          lineStyle: { color: '#0284c7', width: 2 },
          areaStyle: { color: 'rgba(2, 132, 199, 0.22)' },
          itemStyle: { color: '#0284c7' }
        }]
      }]
    };
    this.miniRadarChart.setOption(option);

    setTimeout(() => {
      if (this.miniRadarChart) this.miniRadarChart.resize();
    }, 200);

    window.addEventListener('resize', () => {
      if (this.miniRadarChart) this.miniRadarChart.resize();
    });
  }

  updateMiniRadar(scores) {
    if (!this.miniRadarChart || !scores) return;
    const values = [
      Math.min(100, Math.max(10, scores.critical_first_aid || scores.cfa || 40)),
      Math.min(100, Math.max(10, scores.diagnostic_accuracy || scores.da || 30)),
      Math.min(100, Math.max(10, scores.differential_thinking || scores.dt || 25)),
      Math.min(100, Math.max(10, scores.safety_awareness || scores.sa || 85)),
      Math.min(100, Math.max(10, scores.physician_patient_comm || scores.ppc || 35)),
      Math.min(100, Math.max(10, scores.clinical_efficiency || scores.ce || 70))
    ];
    this.miniRadarChart.setOption({
      series: [{
        data: [{
          value: values,
          name: 'OSCE 实时思维雷达'
        }]
      }]
    });
  }

  renderOSCERadar(containerId, scores) {
    const dom = document.getElementById(containerId);
    if (!dom || typeof echarts === 'undefined') return;

    if (this.radarChart) {
      this.radarChart.dispose();
    }
    this.radarChart = echarts.init(dom);

    const indicators = [
      { name: '急救处置力', max: 100 },
      { name: '诊断精准度', max: 100 },
      { name: '鉴别思维广度', max: 100 },
      { name: '安全与禁忌防范', max: 100 },
      { name: '医患沟通力', max: 100 },
      { name: '临床路径效率', max: 100 }
    ];

    const studentValues = [
      scores.critical_first_aid || 0,
      scores.diagnostic_accuracy || 0,
      scores.differential_thinking || 0,
      scores.safety_awareness || 0,
      scores.physician_patient_comm || 0,
      scores.clinical_efficiency || 0
    ];

    const expertValues = [100, 100, 100, 100, 100, 100];

    const option = {
      backgroundColor: '#ffffff',
      legend: {
        data: ['学员决策得分', '专家金标准基准'],
        bottom: 5,
        textStyle: { color: '#334155', fontWeight: 'bold', fontSize: 11 }
      },
      tooltip: {
        confine: true
      },
      radar: {
        indicator: indicators,
        radius: '65%',
        splitNumber: 4,
        axisName: {
          color: '#0f172a',
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: 'bold'
        },
        splitLine: { lineStyle: { color: '#cbd5e1' } },
        splitArea: {
          areaStyle: {
            color: ['#ffffff', '#f8fafc', '#ffffff', '#f1f5f9']
          }
        },
        axisLine: { lineStyle: { color: '#94a3b8' } }
      },
      series: [{
        type: 'radar',
        data: [
          {
            value: studentValues,
            name: '学员决策得分',
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { color: '#0284c7', width: 2.5 },
            areaStyle: { color: 'rgba(2, 132, 199, 0.3)' },
            itemStyle: { color: '#0284c7' }
          },
          {
            value: expertValues,
            name: '专家金标准基准',
            symbol: 'none',
            lineStyle: { color: '#94a3b8', width: 1.5, type: 'dashed' },
            areaStyle: { color: 'rgba(148, 163, 184, 0.08)' }
          }
        ]
      }]
    };

    this.radarChart.setOption(option);
  }

  renderDAGComparison(containerId, comparisonData) {
    const dom = document.getElementById(containerId);
    if (!dom || typeof echarts === 'undefined' || !comparisonData) return;

    if (this.dagChart) {
      this.dagChart.dispose();
    }
    this.dagChart = echarts.init(dom);

    const nodes = (comparisonData.nodes || []).map(n => {
      const isCompleted = n.status === 'completed';
      const isFatal = n.critical && !isCompleted;

      return {
        id: n.id,
        name: n.id,
        x: n.x || 100,
        y: n.y || 100,
        category: n.category,
        tooltip: `${n.name} (${isCompleted ? '✓ 已规范执行' : '✗ 遗漏或未触发'})`,
        symbolSize: n.critical ? 32 : 24,
        itemStyle: {
          color: isCompleted ? '#059669' : (isFatal ? '#f43f5e' : '#f1f5f9'),
          borderColor: isCompleted ? '#047857' : (isFatal ? '#e11d48' : '#cbd5e1'),
          borderWidth: 2
        },
        label: {
          show: true,
          formatter: n.id,
          color: isCompleted || isFatal ? '#ffffff' : '#1e293b',
          fontSize: 10,
          fontWeight: 'bold'
        }
      };
    });

    const links = (comparisonData.links || []).map(l => {
      const isTraversed = l.traversed;
      return {
        source: l.source,
        target: l.target,
        lineStyle: {
          color: isTraversed ? '#059669' : '#cbd5e1',
          width: isTraversed ? 2.5 : 1,
          type: isTraversed ? 'solid' : 'dashed',
          curveness: 0.1
        }
      };
    });

    const option = {
      backgroundColor: '#ffffff',
      tooltip: {
        trigger: 'item',
        formatter: (params) => params.data.tooltip || params.name
      },
      legend: {
        show: false
      },
      series: [{
        type: 'graph',
        layout: 'none',
        roam: true,
        label: {
          position: 'inside'
        },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [4, 8],
        data: nodes,
        links: links,
        lineStyle: {
          opacity: 0.9
        }
      }]
    };

    this.dagChart.setOption(option);
    setTimeout(() => {
      if (this.dagChart) this.dagChart.resize();
    }, 120);
  }

  resize() {
    if (this.miniRadarChart) this.miniRadarChart.resize();
    if (this.radarChart) this.radarChart.resize();
    if (this.dagChart) this.dagChart.resize();
  }
}

window.dagViewManager = new DAGViewManager();
window.addEventListener('resize', () => {
  if (window.dagViewManager) window.dagViewManager.resize();
});
