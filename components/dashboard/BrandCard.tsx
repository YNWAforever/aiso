import Link from 'next/link'
import { BarChart2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Client } from '@/lib/types'

interface Props {
  client: Client
  lang: string
  sovScore?: number
}

export function BrandCard({ client, lang, sovScore }: Props) {
  return (
    <Link href={`/${lang}/dashboard/${client.id}`} className="group">
      <Card className="hover:border-primary/50 hover:shadow-md transition-all duration-200 cursor-pointer">
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart2 className="size-4 text-primary" />
            </div>
            {client.industry && (
              <Badge variant="secondary" className="text-[10px]">
                {client.industry}
              </Badge>
            )}
          </div>
          <h3 className="font-semibold text-foreground text-sm group-hover:text-primary transition-colors">
            {client.brand_name}
          </h3>
          {client.domain && (
            <p className="text-xs text-muted-foreground mt-0.5">{client.domain}</p>
          )}
          {sovScore !== undefined && (
            <div className="mt-4 pt-3 border-t">
              <p className="text-2xl font-black text-primary">
                {sovScore}%
                <span className="text-xs font-normal text-muted-foreground ml-1">SoV</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
