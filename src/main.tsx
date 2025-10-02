import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import MultiPreview from './sam/preview.tsx'
import { noiseLightRaysConfig } from './playgrounds/noise-light-rays-playground-frame/index.tsx'
import { rainDropsConfig } from './playgrounds/rain-drops-playground-frame/index.tsx'
import { sdfBorederFlowConfig } from './playgrounds/sdf-border-flow-playground-frame/index.tsx'
import { marchingAntsCheapConfig } from './playgrounds/marching-ants/index.tsx'
import { radialWaveConfig } from './playgrounds/running-light-glare/index.tsx'



createRoot(document.getElementById('root')!).render(
  <StrictMode>
      <MultiPreview
          gridStep={96}
          iouThreshold={10}
          simplifyTolerance={1.5}
          minAreaPx={400}
          configs={{
              'Лучи': noiseLightRaysConfig,
              'Капли': rainDropsConfig,
              'Волны': sdfBorederFlowConfig,
              'Штриховка быстро': marchingAntsCheapConfig,
              'Блик радиальный': radialWaveConfig,
      }}
          defaultConfig={'Лучи'}
      />
  </StrictMode>,
)
