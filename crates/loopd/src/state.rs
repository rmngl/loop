use std::path::PathBuf;
use std::sync::Arc;

use loop_scheduler::{Scheduler, WakeQueue};
use loop_store::Store;

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub wake: Arc<WakeQueue>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub async fn new(db_path: PathBuf) -> loop_core::error::Result<Self> {
        let store = Store::connect(&db_path).await?;
        let wake = Arc::new(WakeQueue::new());
        let data_dir = db_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        Ok(Self {
            store,
            wake,
            data_dir,
        })
    }

    pub fn scheduler(&self) -> Scheduler<'_> {
        Scheduler::new(&self.store, Arc::clone(&self.wake))
    }
}