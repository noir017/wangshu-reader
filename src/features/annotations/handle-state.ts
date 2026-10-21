// 选择手柄是否正在拖动：拖动时选择条先藏起来，松手后再按新选区重新定位。
import { create } from 'zustand';

export const useHandleDrag = create<{ dragging: boolean }>(() => ({ dragging: false }));
