import { RecipeId } from '../state/GameState';

export type RecipeCategory = 'drink' | 'food';

export interface RecipeDefinition {
  id: RecipeId;
  name: string;
  shortName: string;
  price: number;
  prepTimeMs: number;
  category: RecipeCategory;
  primaryColor: number;
  accentColor: number;
}

export const RECIPES: Record<string, RecipeDefinition> = {
  teh_tarik: {
    id: 'teh_tarik',
    name: 'Teh Tarik',
    shortName: 'Teh Tarik',
    price: 2.5,
    prepTimeMs: 1500,
    category: 'drink',
    primaryColor: 0xc27838,
    accentColor: 0xfef3c7,
  },
  milo_ais: {
    id: 'milo_ais',
    name: 'Milo Ais',
    shortName: 'Milo Ais',
    price: 3.5,
    prepTimeMs: 1500,
    category: 'drink',
    primaryColor: 0x3e2723,
    accentColor: 0x16a34a,
  },
  roti_canai: {
    id: 'roti_canai',
    name: 'Roti Canai',
    shortName: 'Roti Canai',
    price: 3.0,
    prepTimeMs: 3000,
    category: 'food',
    primaryColor: 0xfbbf24,
    accentColor: 0xd97706,
  },
  maggi_goreng: {
    id: 'maggi_goreng',
    name: 'Maggi Goreng',
    shortName: 'Maggi Grg',
    price: 6.0,
    prepTimeMs: 3000,
    category: 'food',
    primaryColor: 0xd97706,
    accentColor: 0xef4444,
  },
  roti_telur: {
    id: 'roti_telur',
    name: 'Roti Telur',
    shortName: 'Roti Telur',
    price: 4.5,
    prepTimeMs: 3000,
    category: 'food',
    primaryColor: 0xfde047,
    accentColor: 0xf97316,
  },
  nasi_kandar: {
    id: 'nasi_kandar',
    name: 'Nasi Kandar',
    shortName: 'Nasi Kandar',
    price: 9.5,
    prepTimeMs: 3000,
    category: 'food',
    primaryColor: 0xf8fafc,
    accentColor: 0xb91c1c,
  },
};

export function getRecipeDef(id: RecipeId): RecipeDefinition {
  return (
    RECIPES[id] ?? {
      id,
      name: id,
      shortName: id,
      price: 3.0,
      prepTimeMs: 2500,
      category: 'food',
      primaryColor: 0xf59e0b,
      accentColor: 0xffffff,
    }
  );
}
