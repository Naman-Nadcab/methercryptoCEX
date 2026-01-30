import Link from 'next/link';
import { ArrowRight, Shield, Zap, Globe, Wallet, BarChart3, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="font-bold text-black">X</span>
            </div>
            <span className="text-xl font-bold">CryptoExchange</span>
          </div>
          
          <div className="hidden md:flex items-center gap-6">
            <Link href="/trade" className="text-muted-foreground hover:text-foreground transition-colors">
              Trade
            </Link>
            <Link href="/p2p" className="text-muted-foreground hover:text-foreground transition-colors">
              P2P
            </Link>
            <Link href="/wallet" className="text-muted-foreground hover:text-foreground transition-colors">
              Wallet
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost">Log In</Button>
            </Link>
            <Link href="/signup">
              <Button>Sign Up</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            Trade Crypto with
            <span className="text-primary"> Confidence</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            The most secure and reliable cryptocurrency exchange. Trade spot markets, 
            use P2P for fiat, and manage your multi-chain wallet all in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className="w-full sm:w-auto">
                Get Started <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/trade">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Start Trading
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-16 max-w-4xl mx-auto">
            <div>
              <div className="text-3xl font-bold text-primary">$2.5B+</div>
              <div className="text-muted-foreground">24h Volume</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">500K+</div>
              <div className="text-muted-foreground">Users</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">150+</div>
              <div className="text-muted-foreground">Trading Pairs</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">9</div>
              <div className="text-muted-foreground">Chains Supported</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Why Choose CryptoExchange?
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Shield className="h-10 w-10 text-primary" />}
              title="Enterprise Security"
              description="AES-256 encryption, HSM-ready infrastructure, and multi-signature wallets protect your assets."
            />
            <FeatureCard
              icon={<Zap className="h-10 w-10 text-primary" />}
              title="Lightning Fast"
              description="Sub-millisecond matching engine processes millions of orders per second with 99.99% uptime."
            />
            <FeatureCard
              icon={<Globe className="h-10 w-10 text-primary" />}
              title="Multi-Chain Support"
              description="Trade assets across Ethereum, BSC, Polygon, Solana, Tron, Bitcoin, and L2 networks."
            />
            <FeatureCard
              icon={<Wallet className="h-10 w-10 text-primary" />}
              title="HD Wallets"
              description="Auto-generated HD wallets for each chain with industry-standard BIP32/BIP44 derivation."
            />
            <FeatureCard
              icon={<BarChart3 className="h-10 w-10 text-primary" />}
              title="Advanced Trading"
              description="Market, limit, stop-loss orders with real-time orderbook and professional charting."
            />
            <FeatureCard
              icon={<Users className="h-10 w-10 text-primary" />}
              title="P2P Trading"
              description="Trade directly with other users. Escrow protection and dispute resolution included."
            />
          </div>
        </div>
      </section>

      {/* Supported Chains */}
      <section className="py-20 px-4">
        <div className="container mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Supported Blockchains</h2>
          <p className="text-muted-foreground mb-12 max-w-2xl mx-auto">
            Deposit and withdraw on all major blockchains with low fees
          </p>
          
          <div className="flex flex-wrap justify-center gap-8">
            {['Ethereum', 'BSC', 'Polygon', 'Arbitrum', 'Optimism', 'Base', 'Solana', 'Tron', 'Bitcoin'].map((chain) => (
              <div
                key={chain}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted"
              >
                <div className="h-6 w-6 rounded-full bg-primary/20" />
                <span className="font-medium">{chain}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-primary/10">
        <div className="container mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Start Trading?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Join hundreds of thousands of traders and experience the future of cryptocurrency exchange.
          </p>
          <Link href="/signup">
            <Button size="lg">
              Create Free Account <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t">
        <div className="container mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-semibold mb-4">Products</h3>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="/trade" className="hover:text-foreground">Spot Trading</Link></li>
                <li><Link href="/p2p" className="hover:text-foreground">P2P Trading</Link></li>
                <li><Link href="/wallet" className="hover:text-foreground">Wallet</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Support</h3>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="/help" className="hover:text-foreground">Help Center</Link></li>
                <li><Link href="/fees" className="hover:text-foreground">Fees</Link></li>
                <li><Link href="/api" className="hover:text-foreground">API</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Company</h3>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="/about" className="hover:text-foreground">About Us</Link></li>
                <li><Link href="/careers" className="hover:text-foreground">Careers</Link></li>
                <li><Link href="/press" className="hover:text-foreground">Press</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Legal</h3>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="/terms" className="hover:text-foreground">Terms of Service</Link></li>
                <li><Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link></li>
                <li><Link href="/kyc" className="hover:text-foreground">KYC Policy</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="mt-12 pt-8 border-t text-center text-muted-foreground">
            <p>&copy; 2024 CryptoExchange. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-xl bg-card border">
      <div className="mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
