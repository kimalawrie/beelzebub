import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/pages/Dashboard";
import Trades from "@/pages/Trades";
import Strategy from "@/pages/Strategy";
import Portfolio from "@/pages/Portfolio";
import Competition from "@/pages/Competition";
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <div className="flex h-full bg-background overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto overscroll-contain">
            <Switch>
              <Route path="/" component={Competition} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/trades" component={Trades} />
              <Route path="/strategy" component={Strategy} />
              <Route path="/portfolio" component={Portfolio} />
              <Route path="/competition" component={Competition} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
