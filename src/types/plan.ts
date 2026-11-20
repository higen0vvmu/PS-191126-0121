export interface Point2D {
  x: number; // millimeters
  y: number; // millimeters
}

export type UnitDisplay = 'mm' | 'cm' | 'm';

export type ViewMode = '2d' | 'split' | '3d';

export type ScalePreset = '1:10' | '1:20' | '1:25' | '1:50' | '1:100' | '1:200';

export type GridSizeMm = 10 | 50 | 100 | 500; // 1cm, 5cm, 10cm, 50cm

export type AngleSnapDeg = 15 | 45 | 90 | 0; // 0 = free

export type WallAlignment = 'center' | 'inner' | 'outer';

export type MaterialPreset =
  | 'paint'
  | 'satin_paint'
  | 'plaster'
  | 'wallpaper'
  | 'paneling'
  | 'wood'
  | 'oak'
  | 'walnut'
  | 'teak'
  | 'smoked_oak'
  | 'parquet'
  | 'herringbone'
  | 'marble'
  | 'calacatta_gold'
  | 'nero_marble'
  | 'travertine'
  | 'slate'
  | 'concrete'
  | 'brick'
  | 'tile'
  | 'hex_tile'
  | 'checker'
  | 'terrazzo'
  | 'fabric'
  | 'boucle'
  | 'velvet'
  | 'leather_cognac'
  | 'leather_black'
  | 'leather_cream'
  | 'metal'
  | 'brass'
  | 'bronze'
  | 'chrome'
  | 'matte_black_metal'
  | 'plastic_matte'
  | 'plastic_gloss'
  | 'glass';

export type EditorTool =
  | 'select'
  | 'pan'
  | 'wall'
  | 'wall_arc'
  | 'split_wall'
  | 'chimney'
  | 'railing'
  | 'door'
  | 'window'
  | 'arch'
  | 'measure_distance'
  | 'measure_area'
  | 'text'
  | 'arrow'
  | 'section_line'
  | 'calibrate_trace'
  | 'eyedropper';

export type CameraPreset =
  | 'perspective'
  | 'isometric'
  | 'top'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'walkthrough'
  | 'section';

export type ResizeAnchor = 'center' | 'left' | 'right';

export type WallAnchorMode = 'free' | 'fixed_left' | 'fixed_right' | 'fixed_length';

export interface Wall {
  id: string;
  name?: string;
  start: Point2D;
  end: Point2D;
  thicknessMm: number;
  heightMm: number;
  alignment: WallAlignment;
  isCurved: boolean;
  curveBulgeMm: number; // perpendicular offset at midpoint
  innerColor: string;
  outerColor: string;
  innerMaterial: MaterialPreset;
  outerMaterial: MaterialPreset;
  innerTextureScale: number;
  outerTextureScale: number;
  innerTextureRotDeg: number;
  outerTextureRotDeg: number;
  hasBaseboard: boolean;
  baseboardHeightMm: number;
  baseboardColor: string;
  hasCrownMolding: boolean;
  crownHeightMm: number;
  crownColor: string;
  anchorMode?: WallAnchorMode;
  lockedSegments?: string[];
  faceFlipped?: boolean;
  visible: boolean;
  locked: boolean;
  groupId?: string;
}

export interface Room {
  id: string;
  name: string;
  polygon: Point2D[];
  areaM2: number;
  perimeterM: number;
  floorColor: string;
  floorMaterial: MaterialPreset;
  floorTextureScale: number;
  floorTextureRotDeg: number;
  floorLevelMm: number; // offset from level base
  hasCeiling: boolean;
  ceilingHeightMm: number;
  ceilingColor: string;
  ceilingMaterial: MaterialPreset;
  visible: boolean;
  locked: boolean;
}

export type OpeningCategory = 'door' | 'window' | 'arch';

export type DoorSubtype =
  | 'single'
  | 'double'
  | 'french'
  | 'pivot'
  | 'sliding'
  | 'pocket'
  | 'bifold'
  | 'entrance'
  | 'garage'
  | 'balcony_single'
  | 'balcony_double'
  | 'doorframe';

export type WindowSubtype =
  | 'single'
  | 'double'
  | 'triple'
  | 'casement'
  | 'awning'
  | 'clerestory'
  | 'fixed'
  | 'sliding'
  | 'bay'
  | 'corner'
  | 'floor_to_ceiling'
  | 'round'
  | 'euro_single'
  | 'euro_double'
  | 'euro_triple'
  | 'euro_terrace';

export type ArchSubtype =
  | 'round_arch'
  | 'pointed_arch'
  | 'segmental_arch'
  | 'plain_opening'
  | 'frame_only'
  | 'passthrough';

export interface Opening {
  id: string;
  name: string;
  wallId: string;
  t: number; // 0..1 parametric center along wall
  category: OpeningCategory;
  subtype: DoorSubtype | WindowSubtype | ArchSubtype;
  widthMm: number;
  heightMm: number;
  sillHeightMm: number;
  frameThicknessMm: number;
  frameColor: string;
  panelColor: string;
  glassColor: string;
  swingSide: 'left' | 'right'; // hinge side
  swingDirection: 'in' | 'out'; // swing toward inner or outer normal
  openAngleDeg: number; // 0..90 for doors
  resizeAnchor?: ResizeAnchor;
  visible: boolean;
  locked: boolean;
  groupId?: string;
}

export interface Curtain {
  id: string;
  name: string;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  elevationMm: number; // bottom height above floor
  widthMm: number;
  heightMm: number;
  style: 'curtains' | 'drapes' | 'blinds' | 'roller_shade';
  rodType: 'rail' | 'pole' | 'concealed';
  fullness: number; // 1.0 - 2.5
  openPercent: number; // 0 = closed, 100 = open
  color: string;
  rodColor: string;
  material: MaterialPreset;
  wallId?: string;
  visible: boolean;
  locked: boolean;
}

export type PartShape =
  | 'box'
  | 'rounded_rect'
  | 'oval'
  | 'cylinder'
  | 'sphere'
  | 'wedge'
  | 'l_profile'
  | 'u_profile'
  | 'arc'
  | 'extruded_svg';

export type PartDetailStyle =
  | 'cushion'
  | 'mattress'
  | 'pillow'
  | 'basin'
  | 'burner'
  | 'gas_hob'
  | 'electric_hob'
  | 'induction_hob'
  | 'oven_front'
  | 'microwave_front'
  | 'fridge_single'
  | 'fridge_double'
  | 'fridge_side_by_side'
  | 'fridge_french'
  | 'wine_cooler'
  | 'toilet_bowl'
  | 'drain'
  | 'foliage'
  | 'rug'
  | 'table_top'
  | 'chair_seat'
  | 'armrest'
  | 'backrest'
  | 'cabinet'
  | 'washer_drum'
  | 'dryer_drum'
  | 'hood_filter'
  | 'drainboard'
  | 'coffee_machine'
  | 'drip_coffee'
  | 'kettle'
  | 'toaster'
  | 'screen'
  | 'wall_tv'
  | 'tub_inner'
  | 'books'
  | 'vase'
  | 'bowl'
  | 'candle_tray'
  | 'art_canvas'
  | 'mirror'
  | 'fringe_rug'
  | 'blanket'
  | 'leaves_palm'
  | 'leaves_olive'
  | 'faucet'
  | 'towel_rail'
  | 'fluted'
  | 'slatted_wood'
  | 'tufted'
  | 'sculptural'
  | 'caster_base'
  | 'lamp_shade'
  | 'lamp_base'
  | 'dishwasher'
  | 'washer_topload'
  | 'stand_mixer'
  | 'planter_pot'
  | 'curtain_pleat'
  | 'blinds_slats'
  | 'roller_blind'
  | 'ac_indoor'
  | 'ac_outdoor';

export interface FurniturePart {
  id: string;
  name: string;
  shape: PartShape;
  detailStyle?: PartDetailStyle;
  xMm: number; // offset from furniture center X
  yMm: number; // offset from furniture center Y (plan)
  zMm: number; // elevation above furniture base (bottom of part)
  widthMm: number;
  depthMm: number;
  heightMm: number;
  rotationDeg: number;
  color: string;
  material: MaterialPreset;
  roughness?: number;
  metalness?: number;
  bevel?: boolean;
  svgPath?: string;
  emissiveEnabled?: boolean;
  emissiveColor?: string;
  emissiveIntensity?: number;
  bloomBoost?: number;
}

export type FurnitureCategory =
  | 'Sofas & Seating'
  | 'Tables & Desks'
  | 'Beds & Bedroom'
  | 'Storage & Media'
  | 'Kitchen'
  | 'Bathroom'
  | 'Lighting'
  | 'Decor & Plants'
  | 'Architectural'
  | 'Outdoor'
  | 'My Library';

export type ProjectionViewId = 'top' | 'front' | 'rear' | 'left' | 'right';

export type RepresentationMode = 'default' | 'silhouette' | 'hidden_line';

export interface SvgPathElementData {
  id: string;
  kind: 'path';
  d: string;
  stroke: string;
  strokeWidthMm: number;
  fill: string;
  fillOpacity: number;
  fillRule?: 'evenodd' | 'nonzero';
  visible: boolean;
  name?: string;
}

export interface SvgLineElementData {
  id: string;
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidthMm: number;
  visible: boolean;
  name?: string;
}

export interface SvgRectElementData {
  id: string;
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  rotationDeg?: number;
  stroke: string;
  strokeWidthMm: number;
  fill: string;
  fillOpacity: number;
  visible: boolean;
  name?: string;
}

export interface SvgEllipseElementData {
  id: string;
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotationDeg?: number;
  stroke: string;
  strokeWidthMm: number;
  fill: string;
  fillOpacity: number;
  visible: boolean;
  name?: string;
}

export interface SvgPolylineElementData {
  id: string;
  kind: 'polyline';
  points: Point2D[];
  closed?: boolean;
  stroke: string;
  strokeWidthMm: number;
  fill: string;
  fillOpacity: number;
  visible: boolean;
  name?: string;
}

export type SvgVectorElement =
  | SvgPathElementData
  | SvgLineElementData
  | SvgRectElementData
  | SvgEllipseElementData
  | SvgPolylineElementData;

export interface ProjectedViewSvg {
  view: ProjectionViewId;
  viewBox: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
  baseWidthMm: number;
  baseHeightMm: number;
  elements: SvgVectorElement[];
  fillElements?: SvgVectorElement[];
}

export interface FurnitureRepresentation {
  mode: RepresentationMode;
  useMaterialFill?: boolean;
  strokeWidthMm?: number;
  geometrySignature?: string;
  sourceBoundsMm?: {
    widthMm: number;
    depthMm: number;
    heightMm: number;
  };
  /** Immutable original SVG drawing views when a valid SVG exists; never overwritten by 3D auto-generation. */
  defaultViews?: Partial<Record<ProjectionViewId, ProjectedViewSvg>>;
  autoViews?: Partial<Record<ProjectionViewId, ProjectedViewSvg>>;
  customViews?: Partial<Record<ProjectionViewId, SvgVectorElement[]>>;
  customViewUpdatedAt?: Partial<Record<ProjectionViewId, string>>;
}

export type MountingType =
  | 'floor'
  | 'wall'
  | 'ceiling'
  | 'freestanding'
  | 'surface';

export type MountingFace =
  | 'bottom'
  | 'top'
  | 'back'
  | 'front'
  | 'left'
  | 'right';

export type FurnitureLightType = 'point' | 'spot' | 'area' | 'linear';

export interface FurnitureLightSource {
  id: string;
  name: string;
  type: FurnitureLightType;
  enabled: boolean;
  colorMode: 'kelvin' | 'hex';
  colorTempK: number; // 1800K warm - 6500K daylight
  colorHex: string;
  intensity: number; // 0 - 4 multiplier
  rangeMm: number; // 400 - 20000 mm attenuation radius/distance
  decay: number; // physical attenuation falloff (1.0 - 2.0)
  xMm: number; // local X offset relative to furniture center
  yMm: number; // local Y offset relative to furniture center in 2D plan
  zMm: number; // local Z elevation relative to furniture base (0 = base)
  aimAzimuthDeg: number; // horizontal aim relative to local +Y (0 = forward/+Y, 90 = right/+X)
  aimElevationDeg: number; // -90 straight down to +90 straight up
  aimRollDeg?: number; // -180 to 180 roll around emission axis (for asymmetric area/linear lights)
  coneAngleDeg?: number; // SpotLight half-cone angle in degrees (10 - 80)
  penumbra?: number; // SpotLight edge softness (0 - 1)
  widthMm?: number; // Area or Linear light width
  lengthMm?: number; // Area light length (or Linear strip thickness)
  castShadow?: boolean;
  sourceRef?: string; // Optional associated part ID or GLB material key
}

export interface GlbMaterialEmissiveOverride {
  materialKey: string;
  materialName: string;
  meshNames: string[];
  enabled: boolean;
  emissiveColor: string;
  emissiveIntensity: number;
  bloomBoost?: number;
  preserveEmissiveMap?: boolean;
}

export interface GlbInspectedMaterial {
  materialKey: string;
  materialName: string;
  meshNames: string[];
  baseColorHex: string;
  hasColorMap: boolean;
  hasEmissiveMap: boolean;
  emissiveHex: string;
  emissiveIntensity: number;
  emissiveDetected: boolean;
  emissiveDisabled: boolean;
  localCenterMm: { xMm: number; yMm: number; zMm: number };
  sizeMm: { widthMm: number; depthMm: number; heightMm: number };
}

export interface CatalogTemplate {
  id: string;
  name: string;
  category: FurnitureCategory;
  description?: string;
  estimatedCostEur?: number;
  fixedSize?: boolean;
  defaultElevationMm?: number;
  defaultMountingType?: MountingType;
  defaultMountingFace?: MountingFace;
  parts: FurniturePart[];
  isLight?: boolean;
  lightingEnabled?: boolean;
  lights?: FurnitureLightSource[];
  glbEmissiveOverrides?: GlbMaterialEmissiveOverride[];
  isCustom?: boolean;
  glbDataUrl?: string;
  glbAssetId?: string;
  svgSource?: string;
  imageDataUrl?: string;
  footprintPolygon?: Point2D[];
  representation?: FurnitureRepresentation;
}

export interface LightConfig {
  enabled: boolean;
  colorTempK: number; // 2200 warm - 6500 cool daylight
  intensity: number; // 0.2 - 2.5 multiplier
}

export interface FurnitureInstance {
  id: string;
  templateId: string;
  name: string;
  category: FurnitureCategory;
  xMm: number;
  yMm: number;
  elevationMm: number;
  rotationDeg: number;
  rotationXDeg?: number;
  rotationYDeg?: number;
  mirroredX: boolean;
  mirroredY: boolean;
  lockProportions: boolean;
  fixedSize?: boolean;
  estimatedCostEur?: number;
  parts: FurniturePart[];
  glbDataUrl?: string;
  glbAssetId?: string;
  svgSource?: string;
  footprintPolygon?: Point2D[];
  representation?: FurnitureRepresentation;
  lightConfig?: LightConfig;
  isLight?: boolean;
  lightingEnabled?: boolean;
  lights?: FurnitureLightSource[];
  glbEmissiveOverrides?: GlbMaterialEmissiveOverride[];
  zOrder?: number;
  mountingType?: MountingType;
  mountingFace?: MountingFace;
  attachedWallId?: string;
  attachedFace?: 'left' | 'right';
  attachedT?: number;
  wallOffsetMm?: number;
  surfaceHostId?: string;
  surfaceLocalXMm?: number;
  surfaceLocalYMm?: number;
  surfaceLocalRotDeg?: number;
  visible: boolean;
  locked: boolean;
  groupId?: string;
}

export type PersonPose =
  | 'standing_man'
  | 'standing_woman'
  | 'child'
  | 'seated'
  | 'walking'
  | 'lying_back'
  | 'lying_side';

export interface PersonInstance {
  id: string;
  name: string;
  pose: PersonPose;
  xMm: number;
  yMm: number;
  elevationMm: number;
  rotationDeg: number;
  heightMm: number; // e.g. 1780 mm
  color: string;
  visible: boolean;
  locked: boolean;
}

export type ArchElementType =
  | 'chimney'
  | 'doorframe'
  | 'column_round'
  | 'column_square'
  | 'beam'
  | 'stairs_straight'
  | 'stairs_l'
  | 'stairs_u'
  | 'stairs_spiral'
  | 'railing'
  | 'niche'
  | 'platform'
  | 'balcony'
  | 'fireplace';

export type RailingStyleId =
  | 'traditional_balusters'
  | 'horizontal_metal'
  | 'glass_panel'
  | 'frameless_glass'
  | 'cable'
  | 'solid_panel'
  | 'modern_minimalist'
  | 'handrail_only';

export type RailingMountingMethod =
  | 'top_mount'
  | 'side_fascia'
  | 'embedded'
  | 'wall_bracket';

export type RailingHandrailShape = 'round' | 'square' | 'rectangular' | 'oval';

export type RailingPostShape = 'square' | 'round' | 'flat';

export type RailingGlassTint = 'clear' | 'low_iron' | 'bronze' | 'smoke';

export interface RailingPathNode {
  xMm: number; // local X relative to ArchElement origin (mm)
  yMm: number; // local Y relative to ArchElement origin (mm)
  elevationMm?: number; // elevation offset relative to ArchElement elevationMm (mm)
}

export interface RailingEdgeToggles {
  front?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;
}

export interface RailingConfig {
  style: RailingStyleId;
  nodes: RailingPathNode[];
  closed?: boolean;
  heightMm: number; // Overall vertical railing height above deck/nosing (mm)
  widthMm: number; // Overall balustrade assembly footprint width/thickness (mm)
  postSpacingMm: number; // Target spacing between structural posts (mm)
  balusterSpacingMm: number; // Spacing between vertical balusters (mm)
  horizontalRailCount: number; // Count of horizontal metal bars for horizontal_metal style
  cableCount: number; // Count of tension cables for cable style
  handrailShape: RailingHandrailShape;
  handrailWidthMm: number; // Width across handrail (mm)
  handrailThicknessMm: number; // Vertical height/thickness of handrail (mm)
  postShape: RailingPostShape;
  postSizeMm: number; // Width/diameter of intermediate posts (mm)
  endPostSizeMm?: number; // Optional heavier newel/end post size (mm)
  balusterSizeMm: number; // Width/diameter of pickets, bars, or cables (mm)
  panelThicknessMm: number; // Glass or solid panel thickness (mm)
  bottomRailEnabled: boolean;
  bottomRailHeightMm: number; // Clearance from floor/nosing to bottom rail (mm)
  mountingMethod: RailingMountingMethod;
  material: MaterialPreset; // Primary frame/post/rail material
  handrailMaterial?: MaterialPreset; // Optional contrasting handrail material (e.g. wood cap)
  handrailColor?: string;
  secondaryMaterial?: MaterialPreset; // Infill material (glass / wood / solid cladding)
  secondaryColor: string; // Infill or panel tint color
  glassTint: RailingGlassTint;
  accentColor: string; // Hardware / clamp / spigot / bracket finish
}

export interface ArchElement {
  id: string;
  name: string;
  type: ArchElementType;
  xMm: number;
  yMm: number;
  elevationMm: number;
  rotationDeg: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  color: string;
  accentColor: string;
  material: MaterialPreset;
  stepCount?: number;
  hasRailing?: boolean;
  railingLeft?: boolean;
  railingRight?: boolean;
  railingEdges?: RailingEdgeToggles;
  stairTurnDirection?: 'left' | 'right';
  railing?: RailingConfig;
  connectToCeiling?: boolean;
  attachedWallId?: string;
  attachedFace?: 'left' | 'right';
  attachedT?: number;
  resizeAnchor?: ResizeAnchor;
  hasBaseboard?: boolean;
  baseboardHeightMm?: number;
  baseboardColor?: string;
  hasCrownMolding?: boolean;
  crownHeightMm?: number;
  crownColor?: string;
  faceColors?: {
    front: string;
    back: string;
    left: string;
    right: string;
  };
  visible: boolean;
  locked: boolean;
  groupId?: string;
}

export interface DistanceMeasurement {
  id: string;
  kind: 'distance';
  start: Point2D;
  end: Point2D;
  label?: string;
}

export interface AreaMeasurement {
  id: string;
  kind: 'area';
  points: Point2D[];
  label?: string;
}

export type Measurement = DistanceMeasurement | AreaMeasurement;

export interface Annotation {
  id: string;
  kind: 'text' | 'arrow';
  xMm: number;
  yMm: number;
  endXMm?: number;
  endYMm?: number;
  text: string;
  color: string;
  fontSizeMm: number;
}

export interface SectionLine {
  id: string;
  start: Point2D;
  end: Point2D;
  flipDirection: boolean;
  active: boolean;
}

export interface BackgroundTrace {
  imageDataUrl: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  opacity: number;
  visible: boolean;
  rotationDeg: number;
}

export interface LayerVisibility {
  walls: boolean;
  rooms: boolean;
  openings: boolean;
  furniture: boolean;
  curtains: boolean;
  people: boolean;
  archElements: boolean;
  measurements: boolean;
  annotations: boolean;
  autoDimensions: boolean;
  grid: boolean;
}

export interface Level {
  id: string;
  name: string;
  elevationMm: number;
  ceilingHeightMm: number;
  walls: Wall[];
  rooms: Room[];
  openings: Opening[];
  curtains: Curtain[];
  furniture: FurnitureInstance[];
  people: PersonInstance[];
  archElements: ArchElement[];
  measurements: Measurement[];
  annotations: Annotation[];
  sectionLine: SectionLine | null;
  backgroundTrace: BackgroundTrace | null;
  layers: LayerVisibility;
}

export interface ProjectSettings {
  preferredUnit: UnitDisplay;
  scale: ScalePreset;
  gridSizeMm: GridSizeMm;
  snapEnabled: boolean;
  angleSnapDeg: AngleSnapDeg;
  orthoMode: boolean;
  autoDimensions: boolean;
  showGrid: boolean;
  cutawayEnabled: boolean;
  cutawayHeightMm: number;
  hideFrontWalls: boolean;
  fovDeg: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  shadowsEnabled: boolean;
  darkMode: boolean;
  timeOfDay3d: 'day' | 'night';
  blackAndWhite2d?: boolean;
  walkEyeHeightMm?: number;
  walkCollisionEnabled?: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeLevelId: string;
  levels: Level[];
  customLibrary: CatalogTemplate[];
  recentColors: string[];
  settings: ProjectSettings;
  embeddedAssets?: Record<string, string>;
}

export type SelectionTarget =
  | { kind: 'wall'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'curtain'; id: string }
  | { kind: 'furniture'; id: string; partId?: string }
  | { kind: 'person'; id: string }
  | { kind: 'arch'; id: string }
  | { kind: 'measurement'; id: string }
  | { kind: 'annotation'; id: string };
