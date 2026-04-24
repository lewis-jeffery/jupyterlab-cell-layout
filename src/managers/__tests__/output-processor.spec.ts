import type * as nbformat from '@jupyterlab/nbformat';

import {
  OutputProcessor,
  classifyOutput,
  primaryMimetype,
  routeOutputs
} from '../output-processor';

function stream(name: 'stdout' | 'stderr', text: string): nbformat.IStream {
  return { output_type: 'stream', name, text };
}

function displayData(
  data: Record<string, string>,
  metadata: Record<string, unknown> = {}
): nbformat.IDisplayData {
  return {
    output_type: 'display_data',
    data: data as nbformat.IMimeBundle,
    metadata: metadata as nbformat.OutputMetadata
  };
}

function executeResult(
  data: Record<string, string>,
  executionCount = 1
): nbformat.IExecuteResult {
  return {
    output_type: 'execute_result',
    data: data as nbformat.IMimeBundle,
    metadata: {} as nbformat.OutputMetadata,
    execution_count: executionCount
  };
}

function errorOutput(): nbformat.IError {
  return {
    output_type: 'error',
    ename: 'ValueError',
    evalue: 'bad',
    traceback: ['traceback line 1']
  };
}

describe('classifyOutput', () => {
  it('classifies stdout stream as text', () => {
    expect(classifyOutput(stream('stdout', 'hello'))).toBe('text');
  });

  it('classifies stderr stream as text', () => {
    expect(classifyOutput(stream('stderr', 'warn'))).toBe('text');
  });

  it('classifies errors as text', () => {
    expect(classifyOutput(errorOutput())).toBe('text');
  });

  it('classifies image/png display as graphics', () => {
    expect(classifyOutput(displayData({ 'image/png': 'base64data' }))).toBe(
      'graphics'
    );
  });

  it('classifies image/svg+xml as graphics', () => {
    expect(
      classifyOutput(displayData({ 'image/svg+xml': '<svg/>' }))
    ).toBe('graphics');
  });

  it('classifies plotly json as graphics', () => {
    expect(
      classifyOutput(
        displayData({ 'application/vnd.plotly.v1+json': '{}' })
      )
    ).toBe('graphics');
  });

  it('classifies vega-lite json as graphics', () => {
    expect(
      classifyOutput(
        displayData({ 'application/vnd.vegalite.v5+json': '{}' })
      )
    ).toBe('graphics');
  });

  it('classifies jupyter widget view as graphics', () => {
    expect(
      classifyOutput(
        displayData({ 'application/vnd.jupyter.widget-view+json': '{}' })
      )
    ).toBe('graphics');
  });

  it('classifies text/html (e.g. DataFrame table) as text', () => {
    expect(classifyOutput(displayData({ 'text/html': '<table/>' }))).toBe(
      'text'
    );
  });

  it('classifies text/plain only as text', () => {
    expect(classifyOutput(executeResult({ 'text/plain': '42' }))).toBe('text');
  });

  it('prefers graphics classification when both text and image are present', () => {
    expect(
      classifyOutput(
        displayData({ 'text/plain': 'fallback', 'image/png': 'base64' })
      )
    ).toBe('graphics');
  });

  it('classifies empty display_data data as text', () => {
    expect(classifyOutput(displayData({}))).toBe('text');
  });
});

describe('primaryMimetype', () => {
  it('returns text/plain for stream', () => {
    expect(primaryMimetype(stream('stdout', 'x'))).toBe('text/plain');
  });

  it('returns error mimetype for error', () => {
    expect(primaryMimetype(errorOutput())).toBe(
      'application/vnd.jupyter.error'
    );
  });

  it('prefers image over text when both present', () => {
    expect(
      primaryMimetype(
        displayData({ 'text/plain': 'x', 'image/png': 'base64' })
      )
    ).toBe('image/png');
  });

  it('prefers text/html over text/plain', () => {
    expect(
      primaryMimetype(
        displayData({ 'text/plain': 'x', 'text/html': '<p>x</p>' })
      )
    ).toBe('text/html');
  });
});

describe('routeOutputs', () => {
  it('routes empty list to empty slots', () => {
    expect(routeOutputs([])).toEqual({ output_a: [], output_b: [] });
  });

  it('routes prints to slot A', () => {
    const out = stream('stdout', 'hello');
    expect(routeOutputs([out])).toEqual({ output_a: [out], output_b: [] });
  });

  it('routes images to slot B', () => {
    const out = displayData({ 'image/png': 'base64' });
    expect(routeOutputs([out])).toEqual({ output_a: [], output_b: [out] });
  });

  it('routes errors to slot A', () => {
    const err = errorOutput();
    expect(routeOutputs([err])).toEqual({ output_a: [err], output_b: [] });
  });

  it('preserves emission order within slot A', () => {
    const a = stream('stdout', 'first');
    const b = stream('stderr', 'second');
    const c = errorOutput();
    const routing = routeOutputs([a, b, c]);
    expect(routing.output_a).toEqual([a, b, c]);
    expect(routing.output_b).toEqual([]);
  });

  it('preserves emission order within slot B', () => {
    const p1 = displayData({ 'image/png': 'one' });
    const p2 = displayData({ 'image/png': 'two' });
    const p3 = displayData({ 'image/png': 'three' });
    const routing = routeOutputs([p1, p2, p3]);
    expect(routing.output_a).toEqual([]);
    expect(routing.output_b).toEqual([p1, p2, p3]);
  });

  it('splits interleaved prints and plots into the right slots', () => {
    const print1 = stream('stdout', 'before plot 1');
    const plot1 = displayData({ 'image/png': 'png1' });
    const print2 = stream('stdout', 'between plots');
    const plot2 = displayData({ 'image/png': 'png2' });
    const print3 = stream('stdout', 'after plot 2');
    const routing = routeOutputs([print1, plot1, print2, plot2, print3]);
    expect(routing.output_a).toEqual([print1, print2, print3]);
    expect(routing.output_b).toEqual([plot1, plot2]);
  });

  it('groups three plots into slot B in emission order', () => {
    const plots = [
      displayData({ 'image/png': '1' }),
      displayData({ 'image/png': '2' }),
      displayData({ 'image/png': '3' })
    ];
    const routing = routeOutputs(plots);
    expect(routing.output_b).toEqual(plots);
  });
});

describe('OutputProcessor class', () => {
  const proc = new OutputProcessor();

  it('exposes route, classify, primaryMimetype, slotContents', () => {
    const items: nbformat.IOutput[] = [
      stream('stdout', 'a'),
      displayData({ 'image/png': 'img' })
    ];
    const routing = proc.route(items);
    expect(proc.classify(items[0])).toBe('text');
    expect(proc.classify(items[1])).toBe('graphics');
    expect(proc.primaryMimetype(items[0])).toBe('text/plain');
    expect(proc.slotContents(routing, 'output_a')).toEqual([items[0]]);
    expect(proc.slotContents(routing, 'output_b')).toEqual([items[1]]);
  });
});
