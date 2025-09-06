type TeamNum = number & { readonly __brand: unique symbol };

//TODO: Doesn't work.
interface ResourceMap {
  'game html': Promise<string>;
  'spritesheet': Promise<Blob> | ImageBitmap;
}
declare const resources: Map<keyof ResourceMap, ResourceMap[keyof ResourceMap]>

declare class BoloGameElement extends HTMLElement {
	#syncHashToScreen: () => void
	#game: BoloGame | undefined
	#keyDownHandler: (this: Document, evt: KeyboardEvent) => void
	#keyUpHandler: (this: Document, evt: KeyboardEvent) => void
	
	//implicits
	shadow: ShadowRoot
    $: (selectors: string) => Element | null
    $$: (selectors: string) => NodeListOf<Element>
}


declare function drawBall(canvas: HTMLCanvasElement | CanvasRenderingContext2D, team: TeamNum, pos: number, text?: string): void

/**
 * min <= val <= max, or (min+max)/2
 * 
 * @remarks
 * Clamps a number to be within bounds.
 *
 * @param min - lower bound
 * @param val - the value to be constrained
 * @param max - upper bound
 * @returns val, min, or max - or if max < min, the average.
 */
declare function constrain(min: number, val: number, max: number): number
