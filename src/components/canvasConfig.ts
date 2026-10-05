import { getAssetUrlsByMetaUrl } from '@tldraw/assets/urls'
import { MaterialShapeUtil } from './shapes/MaterialShapeUtil'
import { EquationShapeUtil } from './shapes/EquationShapeUtil'
import { GraphShapeUtil } from './shapes/GraphShapeUtil'
import { HighlightShapeUtil } from './shapes/HighlightShapeUtil'
import { RegionShapeUtil } from './shapes/RegionShapeUtil'
import { TableShapeUtil } from './shapes/TableShapeUtil'

export const shapeUtils = [MaterialShapeUtil, EquationShapeUtil, GraphShapeUtil, HighlightShapeUtil, RegionShapeUtil, TableShapeUtil]
export const assetUrls = getAssetUrlsByMetaUrl()
