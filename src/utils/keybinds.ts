import { EditorTool } from '../types/plan';

export type KeybindAction =
  | 'select'
  | 'pan'
  | 'wall'
  | 'wall_arc'
  | 'split_wall'
  | 'chimney'
  | 'door'
  | 'window'
  | 'arch'
  | 'railing'
  | 'measure_distance'
  | 'measure_area'
  | 'text'
  | 'arrow'
  | 'section_line'
  | 'toggle_grid'
  | 'toggle_snap'
  | 'rotate_cw'
  | 'fit_screen';

export type KeybindMap = Record<KeybindAction, string>;

export const DEFAULT_KEYBINDS: KeybindMap = {
  select: 'a',
  pan: 's',
  wall: 'w',
  wall_arc: 'q',
  split_wall: 'x',
  chimney: 'b',
  door: 'd',
  window: 'e',
  arch: 'c',
  railing: 'l',
  measure_distance: 'm',
  measure_area: 'f',
  text: 't',
  arrow: 'y',
  section_line: 'u',
  toggle_grid: 'g',
  toggle_snap: 'k',
  rotate_cw: 'r',
  fit_screen: '0',
};

export interface KeybindDefinition {
  action: KeybindAction;
  label: string;
  group: 'Drawing & Placement Tools' | 'Measurements & Annotations' | 'Navigation & Quick Actions';
  description: string;
}

export const KEYBIND_DEFINITIONS: KeybindDefinition[] = [
  {
    action: 'select',
    label: 'Select & Edit',
    group: 'Drawing & Placement Tools',
    description: 'Select walls, rooms, furniture parts, and drag handles',
  },
  {
    action: 'pan',
    label: 'Pan Canvas',
    group: 'Drawing & Placement Tools',
    description: 'Left-drag to move around (or hold Middle Mouse anytime)',
  },
  {
    action: 'wall',
    label: 'Straight Wall',
    group: 'Drawing & Placement Tools',
    description: 'Click corners to draw walls; auto-returns to Select when done',
  },
  {
    action: 'wall_arc',
    label: 'Curved Arc Wall',
    group: 'Drawing & Placement Tools',
    description: 'Draw a curved architectural wall segment',
  },
  {
    action: 'split_wall',
    label: 'Split Wall',
    group: 'Drawing & Placement Tools',
    description: 'Insert a corner joint point inside an existing wall',
  },
  {
    action: 'chimney',
    label: 'Place Chimney / Block',
    group: 'Drawing & Placement Tools',
    description: 'Create a structural cube/parallelepiped that attaches flush to walls',
  },
  {
    action: 'door',
    label: 'Place Door',
    group: 'Drawing & Placement Tools',
    description: 'Click along any wall to insert a swing, sliding, or pocket door',
  },
  {
    action: 'window',
    label: 'Place Window',
    group: 'Drawing & Placement Tools',
    description: 'Click along any wall to insert a window opening',
  },
  {
    action: 'arch',
    label: 'Place Arch / Opening',
    group: 'Drawing & Placement Tools',
    description: 'Insert a round arch, pointed arch, or cased opening',
  },
  {
    action: 'railing',
    label: 'Draw Railing / Balustrade',
    group: 'Drawing & Placement Tools',
    description: 'Draw multi-point or sloped railings along staircases and balconies',
  },
  {
    action: 'measure_distance',
    label: 'Corner Distance',
    group: 'Measurements & Annotations',
    description: 'Measure exact metric distance between two corners',
  },
  {
    action: 'measure_area',
    label: 'Area Finder',
    group: 'Measurements & Annotations',
    description: 'Click a room or trace corners to inspect m² area',
  },
  {
    action: 'text',
    label: 'Text Note',
    group: 'Measurements & Annotations',
    description: 'Place a metric design label on the plan',
  },
  {
    action: 'arrow',
    label: 'Arrow Callout',
    group: 'Measurements & Annotations',
    description: 'Draw a directional pointer annotation',
  },
  {
    action: 'section_line',
    label: 'Section Cut',
    group: 'Measurements & Annotations',
    description: 'Place a 2D/3D architectural section plane line',
  },
  {
    action: 'rotate_cw',
    label: 'Rotate Selected (+15°)',
    group: 'Navigation & Quick Actions',
    description: 'Rotate selected furniture, person, or arch (Shift for -15°)',
  },
  {
    action: 'toggle_grid',
    label: 'Toggle Grid',
    group: 'Navigation & Quick Actions',
    description: 'Show or hide the metric 2D floor grid',
  },
  {
    action: 'toggle_snap',
    label: 'Toggle Snap',
    group: 'Navigation & Quick Actions',
    description: 'Enable or disable corner, wall, and grid snapping',
  },
  {
    action: 'fit_screen',
    label: 'Fit Plan to Screen',
    group: 'Navigation & Quick Actions',
    description: 'Center and zoom the 2D plan cleanly in the viewport',
  },
];

export const TOOL_TO_KEYBIND: Partial<Record<EditorTool, KeybindAction>> = {
  select: 'select',
  pan: 'pan',
  wall: 'wall',
  wall_arc: 'wall_arc',
  split_wall: 'split_wall',
  chimney: 'chimney',
  door: 'door',
  window: 'window',
  arch: 'arch',
  railing: 'railing',
  measure_distance: 'measure_distance',
  measure_area: 'measure_area',
  text: 'text',
  arrow: 'arrow',
  section_line: 'section_line',
};

export function normalizeKeyString(rawKey: string): string {
  const lower = rawKey.trim().toLowerCase();
  if (lower === 'space' || rawKey === ' ') return 'space';
  return lower;
}

export function normalizeKeybindMap(raw?: Record<string, string> | null): KeybindMap {
  const out: KeybindMap = { ...DEFAULT_KEYBINDS };
  if (!raw) return out;
  for (const action of Object.keys(DEFAULT_KEYBINDS) as KeybindAction[]) {
    const val = raw[action];
    if (typeof val === 'string' && val.trim().length > 0) {
      out[action] = normalizeKeyString(val);
    }
  }
  return out;
}

export function formatKeyLabel(key: string): string {
  if (key === 'space' || key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function rebindKey(
  current: KeybindMap,
  action: KeybindAction,
  rawNewKey: string
): { next: KeybindMap; swappedWith?: KeybindAction } {
  const normalized = normalizeKeyString(rawNewKey);
  if (!normalized || normalized === 'escape' || normalized === 'enter' || normalized === 'tab') {
    return { next: current };
  }
  const previousKey = current[action];
  if (previousKey === normalized) return { next: current };

  const next: KeybindMap = { ...current };
  let swappedWith: KeybindAction | undefined;
  for (const other of Object.keys(next) as KeybindAction[]) {
    if (other !== action && next[other] === normalized) {
      next[other] = previousKey;
      swappedWith = other;
      break;
    }
  }
  next[action] = normalized;
  return { next, swappedWith };
}

export function matchKeybindAction(eventKey: string, map: KeybindMap): KeybindAction | null {
  const normalized = normalizeKeyString(eventKey);
  for (const action of Object.keys(map) as KeybindAction[]) {
    if (map[action] === normalized) return action;
  }
  return null;
}

export interface ToolTutorial {
  id: string;
  keybindAction?: KeybindAction;
  title: string;
  category: 'Navigation' | 'Structure & Openings' | 'Measurements & Notes' | '3D & Furniture';
  summary: string;
  steps: string[];
  tip: string;
}

export const TOOL_TUTORIALS: ToolTutorial[] = [
  {
    id: 'select',
    keybindAction: 'select',
    title: 'Select & Edit',
    category: 'Navigation',
    summary: 'Select any wall, room floor, opening, or individual furniture part to move, resize, or color it.',
    steps: [
      'Click any element once to select it and reveal its properties on the right.',
      'Click an already-selected multi-part furniture piece a second time to select and resize an individual part (like a cushion or table leg).',
      'Drag empty canvas space to marquee-select multiple items at once.',
    ],
    tip: 'Every drawing or placement tool automatically returns to Select once your action is complete.',
  },
  {
    id: 'pan',
    keybindAction: 'pan',
    title: 'Pan & Middle-Mouse Hold',
    category: 'Navigation',
    summary: 'Move smoothly across large architectural floorplans without changing your active tool.',
    steps: [
      'Hold down the Middle Mouse Button anywhere on the 2D canvas and drag to pan; release to stop immediately.',
      'Or press your Pan shortcut to left-drag around the plan.',
      'Use + / - keys, mouse wheel, or type an exact % in the bottom toolbar to zoom.',
    ],
    tip: 'Middle mouse pan is hold-only, so it never locks you out of your current drawing tool.',
  },
  {
    id: 'wall',
    keybindAction: 'wall',
    title: 'Straight Wall',
    category: 'Structure & Openings',
    summary: 'Draft clean metric rooms of any shape with automatic corner mitering and room detection.',
    steps: [
      'Click to place the first corner, then click each subsequent corner to extend connected walls.',
      'Click back on your starting corner to close the loop and auto-detect the room — the editor automatically switches back to Select.',
      'Double-click, press Enter, or press Esc after drawing a wall segment to finish and switch back to Select.',
    ],
    tip: 'Connected corners fuse seamlessly without extra inner seam lines; adjust Wall Alignment (Inner / Center / Outer) in the inspector.',
  },
  {
    id: 'wall_arc',
    keybindAction: 'wall_arc',
    title: 'Curved Arc Wall',
    category: 'Structure & Openings',
    summary: 'Create sweeping curved architectural walls for bay lounges or rounded partitions.',
    steps: [
      'Click the start point of the curved wall.',
      'Click the end point — a smooth arc wall is created and switches back to Select.',
      'Use the curve bulge slider in the right inspector to fine-tune the arc radius.',
    ],
    tip: 'Hold Shift or disable Snap temporarily if you want freeform angles.',
  },
  {
    id: 'split_wall',
    keybindAction: 'split_wall',
    title: 'Split Wall',
    category: 'Structure & Openings',
    summary: 'Divide an existing wall at a precise point to branch a T-junction or change wall thickness.',
    steps: [
      'Activate Split Wall and hover over any existing wall segment.',
      'Click the point where you want the new corner vertex inserted.',
      'Existing doors and windows stay properly mapped onto the new halves, and the tool returns to Select.',
    ],
    tip: 'Useful when turning one wide living wall into two differently colored or recessed sections.',
  },
  {
    id: 'chimney',
    keybindAction: 'chimney',
    title: 'Chimney & Structural Blocks',
    category: 'Structure & Openings',
    summary: 'Add structural cubes or parallelepipeds (like chimneys) that snap flush to walls and inherit wall finishes.',
    steps: [
      'Select Chimney and click on the plan or along any wall face to snap flush and merge boundaries seamlessly.',
      'Enable Extend to Ceiling in the inspector to match room ceiling height automatically.',
      'In Cut-Through View, click an active wall or its exposed parallel face to place or adjust attached blocks.',
    ],
    tip: 'Attached chimneys participate in wall dimension chains and can be locked individually.',
  },
  {
    id: 'door',
    keybindAction: 'door',
    title: 'Doors',
    category: 'Structure & Openings',
    summary: 'Insert single, double, sliding, pocket, bifold, entrance, or garage doors directly into walls.',
    steps: [
      'Open the Door chevron menu in the bottom dock to pick your door subtype.',
      'Click along any wall to snap and insert the door; the tool automatically switches back to Select.',
      'Use the right inspector to flip swing side, opening angle, width (cm/mm), and frame/panel color.',
    ],
    tip: 'Doors automatically cut openings in both 2D wall outlines and 3D geometry.',
  },
  {
    id: 'window',
    keybindAction: 'window',
    title: 'Windows',
    category: 'Structure & Openings',
    summary: 'Place single, double, triple, fixed, bay, corner, round, or floor-to-ceiling windows.',
    steps: [
      'Pick a window style from the Window chevron menu or press the Window shortcut.',
      'Click on any wall to place it cleanly at that position and return to Select.',
      'Edit sill height, glazing tint, and frame thickness in millimeters or centimeters.',
    ],
    tip: 'Pair Full Height windows with the 3D Sun azimuth slider to preview natural daylighting.',
  },
  {
    id: 'arch',
    keybindAction: 'arch',
    title: 'Arches & Openings',
    category: 'Structure & Openings',
    summary: 'Create open archways, cased frames, or kitchen passthroughs connecting rooms.',
    steps: [
      'Choose Round Arch, Pointed Arch, Segmental Arch, Cased Frame, or Passthrough.',
      'Click a wall to insert the opening and automatically return to Select.',
      'Adjust opening width and sill height in the inspector.',
    ],
    tip: 'Great for connecting dining and living areas while keeping distinct floor textures per room.',
  },
  {
    id: 'railing',
    keybindAction: 'railing',
    title: 'Architectural Railings & Balustrades',
    category: 'Structure & Openings',
    summary: 'Draw straight, angled, multi-segment, or sloped railings across floors, balconies, and stairs.',
    steps: [
      'Select Railing in the bottom dock (or pick a style preset in Catalog > Architecture) and click corner points.',
      'Snap directly onto staircase sides or balcony edges to inherit stair pitch and deck elevation automatically.',
      'Double-click, press Enter, or click back on the first node to finish your continuous railing.',
    ],
    tip: 'Switch between glass panel, frameless glass, cable, baluster, solid, minimalist, and handrail-only styles anytime in the inspector.',
  },
  {
    id: 'measure_distance',
    keybindAction: 'measure_distance',
    title: 'Corner Distance Measurement',
    category: 'Measurements & Notes',
    summary: 'Snap strictly to wall and furniture corners to verify clearances and spans.',
    steps: [
      'Activate Distance and click your first wall or furniture corner (green circle indicates a corner snap).',
      'Click the second corner to display the exact metric span.',
      'Click Done (or press Enter / Esc) when finished to dismiss the measurement and return to Select.',
    ],
    tip: 'Distance snapping ignores wall midpoints so diagonal and corner-to-corner measurements stay exact.',
  },
  {
    id: 'measure_area',
    keybindAction: 'measure_area',
    title: 'Transient Area Finder',
    category: 'Measurements & Notes',
    summary: 'Inspect exact m² floor area and perimeter on demand without cluttering the plan.',
    steps: [
      'Click directly inside any detected room to highlight it and show its m² area and perimeter.',
      'Or click 3+ corners manually to measure any custom polygon area.',
      'Click Done (or press Enter / Esc) to clear the overlay and return to Select.',
    ],
    tip: 'Area numbers stay hidden during normal drafting so your floorplan stays crisp and presentation-ready.',
  },
  {
    id: 'text',
    keybindAction: 'text',
    title: 'Text Note',
    category: 'Measurements & Notes',
    summary: 'Drop clean architectural annotations anywhere on your plan.',
    steps: [
      'Activate Note and click where you want the label placed.',
      'The tool returns to Select with the new note highlighted so you can edit its text and font size immediately.',
    ],
    tip: 'Text notes stay crisp at every zoom level and export cleanly to SVG and PDF sheets.',
  },
  {
    id: 'arrow',
    keybindAction: 'arrow',
    title: 'Arrow Callout',
    category: 'Measurements & Notes',
    summary: 'Point out circulation paths, sightlines, or fixture notes with a two-click leader arrow.',
    steps: [
      'Open the Note chevron menu (or press the Arrow shortcut) and click the tail start point.',
      'Click the arrowhead target point; the tool finishes and returns to Select.',
    ],
    tip: 'Customize arrow color and label text in the right inspector.',
  },
  {
    id: 'section_line',
    keybindAction: 'section_line',
    title: 'Section Cut Line',
    category: 'Measurements & Notes',
    summary: 'Define an architectural clipping plane across your plan for 3D section views.',
    steps: [
      'Activate Section Cut and click two points across the floorplan.',
      'Switch to 3D View or Cut-Through View and click the "Section" camera preset to inspect the interior slice.',
    ],
    tip: 'Toggle Flip Direction in the inspector to look from either side of the cut.',
  },
  {
    id: '3d_sun_sky',
    title: '3D View, Sun & Multi-Part Catalog',
    category: '3D & Furniture',
    summary: 'Inspect white maquette models or custom-colored interiors under real-time directional sunlight.',
    steps: [
      'Drag the Sun Azimuth and Sun Elevation sliders in the 3D toolbar to move the visible sun across the skybox.',
      'Use + Build in the left Catalog to combine custom primitives (ovals, rounded rectangles, cylinders, boxes), or click individual furniture parts on canvas to resize and recolor them.',
    ],
    tip: 'All models and custom keybinds automatically save to your account when signed in.',
  },
];
