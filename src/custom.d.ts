declare module "*.png" {
  const value: string;
  export default value;
}

declare module "*.jpg" {
  const value: string;
  export default value;
}

declare module "*.jpeg" {
  const value: string;
  export default value;
}

declare module "*.svg" {
  const value: string;
  export default value;
}

declare module "katex/contrib/auto-render" {
  export interface AutoRenderOptions {
    delimiters?: Array<{
      left: string;
      right: string;
      display: boolean;
    }>;
    ignoredTags?: string[];
    ignoredClasses?: string[];
    errorCallback?: (msg: string, err: any) => void;
    preProcess?: (math: string) => string;
    throwOnError?: boolean;
    errorColor?: string;
    renderToHTMLTree?: boolean;
    displayMode?: boolean;
  }
  export default function renderMathInElement(elem: HTMLElement, options?: AutoRenderOptions): void;
}
