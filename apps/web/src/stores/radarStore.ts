import { create } from 'zustand';

export type LayerId =
  | 'news'
  | 'provinces'
  | 'weather'
  | 'economic'
  | 'alerts'
  | 'infrastructure'
  | 'flights';

export type PanelId = 'news' | 'economic' | 'alerts';

export interface PanelVisibility {
  news: boolean;
  economic: boolean;
  alerts: boolean;
}

export interface RadarState {
  /** Set of active layer IDs */
  activeLayers: Set<LayerId>;
  /** Currently selected province name, or null */
  selectedProvince: string | null;
  /** Panel visibility toggles */
  panelVisibility: PanelVisibility;
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
  /** Toggle a panel's visibility */
  togglePanel: (panel: PanelId) => void;
  /** Toggle sidebar collapsed state */
  toggleSidebar: () => void;
}

export type RadarStore = RadarState & RadarActions;

export const useRadarStore = create<RadarStore>((set) => ({
  // State
  activeLayers: new Set<LayerId>(['provinces']),
  selectedProvince: null,
  panelVisibility: {
    news: true,
    economic: true,
    alerts: true,
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

  togglePanel: (panel) =>
    set((state) => ({
      panelVisibility: {
        ...state.panelVisibility,
        [panel]: !state.panelVisibility[panel],
      },
    })),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
