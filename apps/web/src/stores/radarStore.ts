import { create } from 'zustand';

export type LayerId =
  | 'news'
  | 'events'
  | 'provinces'
  | 'weather'
  | 'economic'
  | 'alerts'
  | 'infrastructure'
  | 'flights'
  | 'earthquakes'
  | 'fires'
  | 'borders'
  | 'security'
  | 'protests';

export type PanelId = 'news' | 'economic' | 'alerts' | 'security' | 'protests';

export interface PanelVisibility {
  news: boolean;
  economic: boolean;
  alerts: boolean;
  security: boolean;
  protests: boolean;
}

export interface SelectedNewsLocation {
  lat: number;
  lng: number;
  articleId: string;
}

export interface RadarState {
  /** Set of active layer IDs */
  activeLayers: Set<LayerId>;
  /** Currently selected province name, or null */
  selectedProvince: string | null;
  /** Currently selected news article location (for map centering) */
  selectedNewsLocation: SelectedNewsLocation | null;
  /** Panel visibility toggles */
  panelVisibility: PanelVisibility;
  /** ID of the event selected for timeline detail view */
  selectedEventId: string | null;
  /** Whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
}

export interface RadarActions {
  /** Toggle a layer on/off */
  toggleLayer: (layer: LayerId) => void;
  /** Activate a layer */
  activateLayer: (layer: LayerId) => void;
  /** Deactivate a layer */
  deactivateLayer: (layer: LayerId) => void;
  /** Select a province (null to deselect) */
  selectProvince: (province: string | null) => void;
  /** Select a news article location (null to clear) */
  selectNewsLocation: (location: SelectedNewsLocation | null) => void;
  /** Toggle a panel's visibility */
  togglePanel: (panel: PanelId) => void;
  /** Select an event for timeline detail view (null to close) */
  selectEvent: (eventId: string | null) => void;
  /** Toggle sidebar collapsed state */
  toggleSidebar: () => void;
}

export type RadarStore = RadarState & RadarActions;

export const useRadarStore = create<RadarStore>((set) => ({
  // State
  activeLayers: new Set<LayerId>(['provinces', 'events']),
  selectedProvince: null,
  selectedNewsLocation: null,
  selectedEventId: null,
  panelVisibility: {
    news: true,
    economic: true,
    alerts: true,
    security: false,
    protests: false,
  },
  sidebarCollapsed: false,

  // Actions
  toggleLayer: (layer) =>
    set((state) => {
      const next = new Set(state.activeLayers);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return { activeLayers: next };
    }),

  activateLayer: (layer) =>
    set((state) => {
      if (state.activeLayers.has(layer)) return state;
      const next = new Set(state.activeLayers);
      next.add(layer);
      return { activeLayers: next };
    }),

  deactivateLayer: (layer) =>
    set((state) => {
      if (!state.activeLayers.has(layer)) return state;
      const next = new Set(state.activeLayers);
      next.delete(layer);
      return { activeLayers: next };
    }),

  selectProvince: (province) =>
    set({ selectedProvince: province }),

  selectNewsLocation: (location) =>
    set({ selectedNewsLocation: location }),

  togglePanel: (panel) =>
    set((state) => ({
      panelVisibility: {
        ...state.panelVisibility,
        [panel]: !state.panelVisibility[panel],
      },
    })),

  selectEvent: (eventId) =>
    set({ selectedEventId: eventId }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
